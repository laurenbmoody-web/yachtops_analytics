// Leave balance — data access. Conventions as elsewhere in services/: every
// export returns { data, error } and never throws, explicit column lists, never
// select('*').
//
// Four reads and a pure calculation. The arithmetic all lives in leaveBalance.js
// so it can be tested without a database; this file only fetches the inputs.

import { supabase } from '../lib/supabaseClient';
import { computeLeaveBalance } from './leaveBalance';

const EMPLOYMENT_SELECT =
  'user_id, start_date, end_date, contract_type, rotation_pattern, rotation_unit, leave_entitlement_days';

const ADJUSTMENT_SELECT =
  'id, days, kind, effective_date, reason, created_by_name, created_at';

// What an adjustment can be, with the sign it is expected to carry. Shown in the
// picker so nobody has to remember the convention: positive grants days,
// negative takes them away.
export const ADJUSTMENT_KINDS = [
  { key: 'opening_balance', label: 'Opening balance', sign: 1,
    hint: 'Days already owed when this contract started, or brought from another vessel.' },
  { key: 'granted', label: 'Extra days granted', sign: 1,
    hint: 'Additional leave agreed on top of the entitlement.' },
  { key: 'bought_out', label: 'Bought out', sign: -1,
    hint: 'Days paid instead of taken.' },
  { key: 'unpaid', label: 'Unpaid leave', sign: -1,
    hint: 'Time off that does not draw on the paid entitlement.' },
  { key: 'correction', label: 'Correction', sign: 0,
    hint: 'A clerical fix, in either direction.' },
];

export const adjustmentKindLabel = (kind) =>
  ADJUSTMENT_KINDS.find((k) => k.key === kind)?.label || 'Adjustment';

// ── reads ────────────────────────────────────────────────────────────────────

// Everything needed to show one crew member's balance.
//
// `source: 'calendar'` rows are excluded for the same reason the Status History
// tab and the rota hook exclude them: they are projections written by the crew
// calendar rather than records of a status actually having changed, and counting
// them would double up against the real transitions.
export async function getLeaveBalance(tenantId, userId, { asOf } = {}) {
  if (!tenantId || !userId) {
    return { data: null, error: new Error('getLeaveBalance: tenant and user required') };
  }

  const [empRes, histRes, adjRes, vesselRes] = await Promise.all([
    supabase
      .from('crew_employment')
      .select(EMPLOYMENT_SELECT)
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('crew_status_history')
      .select('new_status, changed_at')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .neq('source', 'calendar')
      .order('changed_at', { ascending: true }),
    supabase
      .from('crew_leave_adjustments')
      .select(ADJUSTMENT_SELECT)
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .order('effective_date', { ascending: true }),
    supabase
      .from('vessels')
      .select('leave_year_anchor, leave_carry_over_max_days')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ]);

  if (empRes.error) return { data: null, error: empRes.error };
  if (histRes.error) return { data: null, error: histRes.error };
  // An adjustments or policy read that fails must not take the whole balance
  // down with it — the accrual is still worth showing. But it has to be
  // admitted to, or the figure silently loses someone's bought-out days.
  const adjustments = adjRes.error ? [] : (adjRes.data || []);
  const policy = vesselRes.error ? null : {
    anchor: vesselRes.data?.leave_year_anchor,
    carryOverMaxDays: vesselRes.data?.leave_carry_over_max_days,
  };

  const balance = computeLeaveBalance({
    employment: empRes.data || {},
    changes: histRes.data || [],
    adjustments,
    policy,
    asOf,
  });

  return {
    data: {
      ...balance,
      adjustmentList: adjustments,
      partial: !!(adjRes.error || vesselRes.error),
    },
    error: null,
  };
}

export async function getLeavePolicy(tenantId) {
  if (!tenantId) return { data: null, error: null };
  const { data, error } = await supabase
    .from('vessels')
    .select('leave_year_anchor, leave_carry_over_max_days')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) return { data: null, error };
  return {
    data: {
      anchor: data?.leave_year_anchor || 'none',
      carryOverMaxDays: data?.leave_carry_over_max_days ?? null,
    },
    error: null,
  };
}

// ── writes ───────────────────────────────────────────────────────────────────

export async function setLeavePolicy(tenantId, { anchor, carryOverMaxDays }) {
  if (!tenantId) return { data: null, error: new Error('No active vessel') };
  const patch = {};
  if (anchor !== undefined) {
    patch.leave_year_anchor = ['none', 'contract', 'calendar'].includes(anchor) ? anchor : 'none';
  }
  if (carryOverMaxDays !== undefined) {
    const n = Number(carryOverMaxDays);
    patch.leave_carry_over_max_days = Number.isFinite(n) && n >= 0 ? n : null;
  }
  const { data, error } = await supabase
    .from('vessels')
    .update(patch)
    .eq('tenant_id', tenantId)
    .select('leave_year_anchor, leave_carry_over_max_days')
    .maybeSingle();
  return { data, error };
}

// Post an adjustment. The sign is the caller's to get right; the kind's expected
// sign is applied here so a Command user typing "3" against "Bought out" gets
// -3 rather than silently crediting days.
export async function addLeaveAdjustment(tenantId, userId, { days, kind, effectiveDate, reason }) {
  if (!tenantId || !userId) return { data: null, error: new Error('Tenant and crew member required') };

  const magnitude = Math.abs(Number(days));
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    return { data: null, error: new Error('Enter a number of days') };
  }
  if (!String(reason || '').trim()) {
    return { data: null, error: new Error('A reason is required') };
  }

  const spec = ADJUSTMENT_KINDS.find((k) => k.key === kind);
  if (!spec) return { data: null, error: new Error('Pick what kind of adjustment this is') };
  // A correction can go either way, so it keeps the sign as typed.
  const signed = spec.sign === 0 ? Number(days) : magnitude * spec.sign;

  const { data: { user } = {} } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('crew_leave_adjustments')
    .insert({
      tenant_id: tenantId,
      user_id: userId,
      days: signed,
      kind,
      effective_date: String(effectiveDate || new Date().toISOString()).slice(0, 10),
      reason: String(reason).trim(),
      created_by: user?.id || null,
      created_by_name: user?.user_metadata?.full_name || null,
    })
    .select(ADJUSTMENT_SELECT)
    .maybeSingle();
  return { data, error };
}

// There is no update path by design — the ledger is append-only, so a mistake is
// corrected by posting the opposite entry. Delete exists for an entry made in
// error moments ago, and Command only.
export async function deleteLeaveAdjustment(id) {
  if (!id) return { error: new Error('deleteLeaveAdjustment: id required') };
  const { error } = await supabase.from('crew_leave_adjustments').delete().eq('id', id);
  return { error };
}

// horMonthStatus — DB-backed HOR monthly confirmation workflow (Phase 3).
//
// Thin wrapper over the hor_month_status table + writer RPCs from migrations
// 20260612140000 / _141000. Replaces the per-device localStorage confirm store.
//
// State machine: open → submitted → approve → confirmed → lock → locked
//                (reopen returns submitted|confirmed → open).
//
// Month convention: callers pass the JS month index (0–11, as used throughout
// the crew-profile HOR UI); this module converts to the DB's 1–12 at the edge.

import { supabase } from '../../../lib/supabaseClient';

const toDbMonth = (jsMonth) => jsMonth + 1;

// Per-vessel workflow settings for the active tenant. The vessels table is
// keyed by tenant_id (one row per tenant), so we look it up that way.
// → { mode: 'require'|'trust', approverTier: 'COMMAND'|'CHIEF'|'HOD' }
export async function fetchVesselHorSettings(tenantId) {
  const fallback = { mode: 'require', approverTier: 'COMMAND' };
  if (!tenantId) return fallback;
  const { data, error } = await supabase
    .from('vessels')
    .select('hor_confirmation_mode, hor_approver_tier')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error || !data) return fallback;
  return {
    mode: data.hor_confirmation_mode || 'require',
    approverTier: data.hor_approver_tier || 'COMMAND',
  };
}

// Status row for one crew member's month, or null if untouched (open).
export async function fetchMonthStatus({ tenantId, subjectUserId, year, jsMonth }) {
  if (!tenantId || !subjectUserId) return null;
  const { data, error } = await supabase
    .from('hor_month_status')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('subject_user_id', subjectUserId)
    .eq('period_year', year)
    .eq('period_month', toDbMonth(jsMonth))
    .maybeSingle();
  if (error) return null;
  return data || null;
}

// Crew submits their own month. In 'trust' mode this returns a 'confirmed' row.
export async function submitMonth({ tenantId, year, jsMonth, note = null, hash = null }) {
  const { data, error } = await supabase.rpc('hor_submit_month', {
    p_tenant_id: tenantId,
    p_year: year,
    p_month: toDbMonth(jsMonth),
    p_note: note,
    p_hash: hash,
  });
  if (error) throw error;
  return data;
}

// Approver confirms a submitted month.
export async function approveMonth({ tenantId, subjectUserId, year, jsMonth, note = null }) {
  const { data, error } = await supabase.rpc('hor_approve_month', {
    p_tenant_id: tenantId,
    p_subject_user_id: subjectUserId,
    p_year: year,
    p_month: toDbMonth(jsMonth),
    p_note: note,
  });
  if (error) throw error;
  return data;
}

// Approver returns a submitted/confirmed month to 'open'.
export async function reopenMonth({ tenantId, subjectUserId, year, jsMonth, note = null }) {
  const { data, error } = await supabase.rpc('hor_reopen_month', {
    p_tenant_id: tenantId,
    p_subject_user_id: subjectUserId,
    p_year: year,
    p_month: toDbMonth(jsMonth),
    p_note: note,
  });
  if (error) throw error;
  return data;
}

// COMMAND locks a confirmed month.
export async function lockMonth({ tenantId, subjectUserId, year, jsMonth }) {
  const { data, error } = await supabase.rpc('hor_lock_month', {
    p_tenant_id: tenantId,
    p_subject_user_id: subjectUserId,
    p_year: year,
    p_month: toDbMonth(jsMonth),
  });
  if (error) throw error;
  return data;
}

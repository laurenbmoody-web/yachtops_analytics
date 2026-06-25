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

// Active members' permission tiers for a tenant, keyed by user_id. Used to make
// the sign-off UI rank-aware (mirrors the RPCs): who may approve whom, and
// whether the subject is top-of-chain (self-certifies). RLS scopes to tenant.
export async function fetchActiveMemberTiers(tenantId) {
  if (!tenantId) return {};
  const { data, error } = await supabase
    .from('tenant_members')
    .select('user_id, permission_tier')
    .eq('tenant_id', tenantId)
    .eq('active', true);
  if (error || !data) return {};
  const byUser = {};
  data.forEach((r) => { byUser[r.user_id] = r.permission_tier; });
  return byUser;
}

// Per-vessel workflow settings for the active tenant. The vessels table is
// keyed by tenant_id (one row per tenant), so we look it up that way.
// → { mode: 'require'|'trust', approverTier: 'COMMAND'|'CHIEF'|'HOD' }
export async function fetchVesselHorSettings(tenantId) {
  const fallback = {
    mode: 'require',
    approverTier: 'COMMAND',
    dayBasis: 'calendar',
    operationalDayStartHour: 0,
    managementCompanyEmail: null,
    managementCompanyName: null,
  };
  if (!tenantId) return fallback;
  const { data, error } = await supabase
    .from('vessels')
    .select('hor_confirmation_mode, hor_approver_tier, hor_day_basis, operational_day_start_hour, hor_management_company_email, hor_management_company_name')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error || !data) return fallback;
  return {
    mode: data.hor_confirmation_mode || 'require',
    approverTier: data.hor_approver_tier || 'COMMAND',
    // Day-basis for the 24h rest rule — MUST match the rota's RestLogView so a
    // day reconciles identically across rota → profile → vessel record.
    dayBasis: data.hor_day_basis || 'calendar',
    operationalDayStartHour: data.operational_day_start_hour ?? 0,
    // Month-end "send to management" recipient (vessel settings).
    managementCompanyEmail: data.hor_management_company_email || null,
    managementCompanyName: data.hor_management_company_name || null,
  };
}

// Vessel identity for the official IMO/ILO "Record of Hours of Rest" header.
// One vessel per tenant (maybeSingle). Returns nulls when unset so the PDF
// header degrades gracefully rather than throwing.
export async function fetchVesselIdentity(tenantId) {
  const fallback = { name: null, flag: null, portOfRegistry: null, imoNumber: null, officialNumber: null };
  if (!tenantId) return fallback;
  const { data, error } = await supabase
    .from('vessels')
    .select('name, flag, port_of_registry, imo_number, official_number')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error || !data) return fallback;
  return {
    name: data.name || null,
    flag: data.flag || null,
    portOfRegistry: data.port_of_registry || null,
    imoNumber: data.imo_number || null,
    officialNumber: data.official_number || null,
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

// All month-status rows for one tenant + period (every crew member), keyed by
// subject_user_id. RLS scopes this to the caller's tenant. Used by the command
// dashboard so the whole roster's workflow state loads in a single query.
export async function fetchMonthStatusesForMonth({ tenantId, year, jsMonth }) {
  if (!tenantId) return {};
  const { data, error } = await supabase
    .from('hor_month_status')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('period_year', year)
    .eq('period_month', toDbMonth(jsMonth));
  if (error) return {};
  const byUser = {};
  (data || []).forEach((row) => { byUser[row.subject_user_id] = row; });
  return byUser;
}

// Crew submits their own month. In 'trust' mode this returns a 'confirmed' row.
// `signature` (optional) carries the drawn-signature audit trail:
//   { path, name, ip, ua } — path is the hor-signatures object from
//   uploadSignature(); the rest is the signer's name / IP / user agent.
export async function submitMonth({ tenantId, year, jsMonth, note = null, hash = null, signature = null }) {
  const { data, error } = await supabase.rpc('hor_submit_month', {
    p_tenant_id: tenantId,
    p_year: year,
    p_month: toDbMonth(jsMonth),
    p_note: note,
    p_hash: hash,
    p_sig_path: signature?.path || null,
    p_signed_name: signature?.name || null,
    p_signed_ip: signature?.ip || null,
    p_signed_ua: signature?.ua || null,
  });
  if (error) throw error;
  return data;
}

// Approver confirms a submitted month, optionally with a counter-signature
// (same { path, name, ip, ua } shape as submitMonth's `signature`).
export async function approveMonth({ tenantId, subjectUserId, year, jsMonth, note = null, signature = null }) {
  const { data, error } = await supabase.rpc('hor_approve_month', {
    p_tenant_id: tenantId,
    p_subject_user_id: subjectUserId,
    p_year: year,
    p_month: toDbMonth(jsMonth),
    p_note: note,
    p_sig_path: signature?.path || null,
    p_signed_name: signature?.name || null,
    p_signed_ip: signature?.ip || null,
    p_signed_ua: signature?.ua || null,
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

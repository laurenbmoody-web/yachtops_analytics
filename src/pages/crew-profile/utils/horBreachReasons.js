// horBreachReasons — DB-backed HOR breach reasons + command sign-off (Phase 4).
//
// Thin wrapper over hor_breach_reasons + its writer RPCs (migration
// 20260613110000). Replaces the per-device localStorage 'cargo_hor_breach_notes'
// store and adds the approver sign-off the localStorage version never had.
//
// Dates are 'YYYY-MM-DD' strings throughout (matching the HOR calendar day keys);
// Postgres casts them to `date` directly.

import { supabase } from '../../../lib/supabaseClient';

const pad2 = (n) => String(n).padStart(2, '0');

// All breach reasons for one crew member in a given month (JS month 0–11).
// → array of rows (note_text, breach_types, signed_off_by/at, …).
export async function fetchBreachReasonsForMonth({ tenantId, subjectUserId, year, jsMonth }) {
  if (!tenantId || !subjectUserId) return [];
  const start = `${year}-${pad2(jsMonth + 1)}-01`;
  const end = `${year}-${pad2(jsMonth + 1)}-${pad2(new Date(year, jsMonth + 1, 0).getDate())}`;
  const { data, error } = await supabase
    .from('hor_breach_reasons')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('subject_user_id', subjectUserId)
    .gte('breach_date', start)
    .lte('breach_date', end);
  if (error || !data) return [];
  return data;
}

// Crew records (or an approver records on their behalf) the reason for a breach.
export async function upsertBreachReason({ tenantId, subjectUserId, date, breachTypes = [], note }) {
  const { data, error } = await supabase.rpc('hor_upsert_breach_reason', {
    p_tenant_id: tenantId,
    p_subject_user_id: subjectUserId,
    p_breach_date: date,
    p_breach_types: breachTypes,
    p_note: note,
  });
  if (error) throw error;
  return data;
}

// Approver signs off a recorded breach reason.
export async function signOffBreachReason({ tenantId, subjectUserId, date }) {
  const { data, error } = await supabase.rpc('hor_sign_off_breach_reason', {
    p_tenant_id: tenantId,
    p_subject_user_id: subjectUserId,
    p_breach_date: date,
  });
  if (error) throw error;
  return data;
}

// Approver clears a sign-off (correction).
export async function unsignBreachReason({ tenantId, subjectUserId, date }) {
  const { data, error } = await supabase.rpc('hor_unsign_breach_reason', {
    p_tenant_id: tenantId,
    p_subject_user_id: subjectUserId,
    p_breach_date: date,
  });
  if (error) throw error;
  return data;
}

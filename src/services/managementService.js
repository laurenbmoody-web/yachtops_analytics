// Cargo Accounts — data access for a management company's login.
//
// Every call here is an RPC, and that is the point. A management user holds no
// table privileges in this schema at all: they are not rows in tenant_members,
// so none of the app's ~130 member-keyed policies can see them, and nothing has
// granted them anything directly. The five functions below are the entire
// surface, and each decides for itself whether the caller manages that vessel.
//
// Two of them write, and only to the month-end lifecycle: sign a closed month
// off, or send it back with a reason. Neither can touch a line the crew entered
// — there is no function that would let them.
//
// See supabase/migrations/20260804104024_management_access.sql.

import { supabase } from '../lib/supabaseClient';

// Postgres wants the first of the month; the app talks in 'YYYY-MM'.
const toPeriod = (monthKey) => (monthKey ? `${String(monthKey).slice(0, 7)}-01` : null);

// Does this login manage anything at all? Cheap enough to ask on boot, and it's
// what decides whether the management surface is offered.
export async function listManagedVessels() {
  const { data, error } = await supabase.rpc('management_fleet');
  return { data: data || [], error };
}

// The months worth opening on one vessel — anything the boat has closed, plus
// anything the office has already sent back.
export async function listManagedPeriods(tenantId) {
  if (!tenantId) return { data: [], error: null };
  const { data, error } = await supabase.rpc('management_periods', { p_tenant_id: tenantId });
  return { data: data || [], error };
}

// One month on one vessel: accounts, reconciliations, a window of lines and the
// vessel's closes. The window is deliberate — see managementView.linesForPeriod,
// which applies the same period rule the boat reconciles by.
export async function getManagedMonth(tenantId, monthKey) {
  const period = toPeriod(monthKey);
  if (!tenantId || !period) return { data: null, error: null };
  const { data, error } = await supabase.rpc('management_month', {
    p_tenant_id: tenantId, p_period_month: period,
  });
  return { data: data || null, error };
}

// ── the only two writes ──────────────────────────────────────────────────────
// The database refuses a month the vessel hasn't closed, so the error it returns
// is worth showing rather than swallowing — it says which state the month is in.
export async function signOffMonth(reconciliationId, note) {
  if (!reconciliationId) return { data: null, error: new Error('No month to sign off') };
  const { data, error } = await supabase.rpc('management_sign_off', {
    p_reconciliation_id: reconciliationId, p_note: note || null,
  });
  return { data: data || null, error };
}

// A query with no reason on it is a rejection the crew have to guess at, so the
// reason is required here as well as in the function — failing before the round
// trip is the difference between a disabled button and a red banner.
export async function queryMonth(reconciliationId, note) {
  const reason = (note || '').trim();
  if (!reconciliationId) return { data: null, error: new Error('No month to query') };
  if (!reason) return { data: null, error: new Error('Say what needs looking at before sending it back') };
  const { data, error } = await supabase.rpc('management_query', {
    p_reconciliation_id: reconciliationId, p_note: reason,
  });
  return { data: data || null, error };
}

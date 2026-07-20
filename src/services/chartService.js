// Cargo Accounts — data-access layer for the tenant chart_of_accounts.
//
// Conventions (matching financeService.js):
//   - every export returns { data, error }, never throws
//   - explicit column lists, never select('*')
//   - RLS-scoped; every read/write is scoped by tenant_id
//
// The chart is the single source of truth for money categories across the module
// (ledger, budgets, reconcile "add to ledger"). It is tenant-owned: a vessel either
// applies the standard template, imports their existing scheme, or starts fresh.
// Two-level shape: bucket (group heading) → category (coded line under it).

import { supabase } from '../lib/supabaseClient';
import { STANDARD_CHART_OF_ACCOUNTS } from '../pages/accounts/budgets/data/mybaChartOfAccounts.js';
import { groupChartLines } from './chartGroup.js';

export { groupChartLines };

const CHART_SELECT =
  'id, tenant_id, bucket, code, category, kind, sort_order, is_active, created_at, updated_at';

// ── reads ────────────────────────────────────────────────────────────────────

// Flat list of a tenant's chart lines, ordered for display (bucket order, then line).
export async function getChart(tenantId, { includeInactive = false } = {}) {
  if (!tenantId) return { data: [], error: null };
  let q = supabase
    .from('chart_of_accounts')
    .select(CHART_SELECT)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })
    .order('bucket', { ascending: true })
    .order('category', { ascending: true });
  if (!includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q;
  return { data: data || [], error };
}

// Same lines grouped under their bucket, ready for a grouped <select> / picker.
// Returns [{ bucket, kind, lines: [{ id, code, category, ... }] }] in sort order.
export async function getChartGrouped(tenantId, opts) {
  const { data, error } = await getChart(tenantId, opts);
  if (error) return { data: [], error };
  return { data: groupChartLines(data), error: null };
}

// Whether the tenant has any chart yet (drives the "set up your chart" empty state).
export async function hasChart(tenantId) {
  if (!tenantId) return { data: false, error: null };
  const { count, error } = await supabase
    .from('chart_of_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);
  return { data: (count || 0) > 0, error };
}

// ── writes ───────────────────────────────────────────────────────────────────

// Insert rows in bulk (used by the standard template + spreadsheet import). Each
// input line is { bucket, category, code?, kind?, sort_order? }.
export async function addLines(tenantId, lines) {
  if (!tenantId || !lines?.length) return { data: [], error: null };
  const rows = lines.map((l, i) => ({
    tenant_id: tenantId,
    bucket: l.bucket,
    category: l.category,
    code: l.code || null,
    kind: l.kind === 'revenue' ? 'revenue' : 'expense',
    sort_order: Number.isFinite(l.sort_order) ? l.sort_order : i,
  }));
  const { data, error } = await supabase
    .from('chart_of_accounts')
    .insert(rows)
    .select(CHART_SELECT);
  return { data: data || [], error };
}

// Apply the built-in MYBA standard template. bucket order → sort_order so the
// grouped picker and budgets read in the report's canonical order.
export async function applyStandardTemplate(tenantId) {
  const lines = STANDARD_CHART_OF_ACCOUNTS.map((l, i) => ({
    bucket: l.bucket,
    category: l.category,
    code: l.code || null,
    kind: l.kind === 'revenue' ? 'revenue' : 'expense',
    sort_order: i,
  }));
  return addLines(tenantId, lines);
}

export async function addLine(tenantId, line) {
  const { data, error } = await addLines(tenantId, [line]);
  return { data: data?.[0] || null, error };
}

export async function updateLine(id, patch) {
  if (!id) return { data: null, error: new Error('updateLine: id required') };
  const allowed = {};
  ['bucket', 'code', 'category', 'kind', 'sort_order', 'is_active'].forEach((k) => {
    if (patch[k] !== undefined) allowed[k] = patch[k];
  });
  const { data, error } = await supabase
    .from('chart_of_accounts')
    .update(allowed)
    .eq('id', id)
    .select(CHART_SELECT)
    .single();
  return { data, error };
}

// Soft-remove: keep the row (historic transactions still reference the label) but
// drop it from pickers. Hard delete is available to COMMAND via deleteLine.
export async function deactivateLine(id) {
  return updateLine(id, { is_active: false });
}

export async function deleteLine(id) {
  if (!id) return { error: new Error('deleteLine: id required') };
  const { error } = await supabase.from('chart_of_accounts').delete().eq('id', id);
  return { error };
}

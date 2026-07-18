// Cargo Accounts — Phase 1. Data access for budgets + budget_lines, and the
// live budget-vs-actual assembly. Same conventions as financeService.js:
// { data, error } (never throws), explicit columns, tenant-scoped.

import { supabase } from '../lib/supabaseClient';
import { computeVsActual } from './budgetCalc.js';

const BUDGET_SELECT =
  'id, tenant_id, name, period_start, period_end, currency, status, notes, created_by, created_at, updated_at';
const LINE_SELECT = 'id, budget_id, bucket, code, kind, category, amount, notes, created_at, updated_at';

// "Committed" = money on order but not yet realised. An order is committed once it
// leaves draft and until it is paid (paid posts to the ledger as Actual — Phase 0
// hook), so committed = supplier_orders.status NOT IN ('draft','paid'). Kept here as
// the single source of truth so it stays in step with the Phase 0 paid rule.
const NON_COMMITTED_STATUSES = ['draft', 'paid'];

const currentUserId = async () => {
  try { const { data } = await supabase.auth.getUser(); return data?.user?.id || null; } catch { return null; }
};

const addDay = (isoDate) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

// ── Budgets ───────────────────────────────────────────────────────────────────

export const listBudgets = async (tenantId) => {
  if (!tenantId) return { data: null, error: new Error('No active tenant') };
  const { data: budgets, error } = await supabase
    .from('budgets').select(BUDGET_SELECT)
    .eq('tenant_id', tenantId)
    .order('period_start', { ascending: false });
  if (error) return { data: null, error };

  const ids = (budgets || []).map((b) => b.id);
  let totals = {};
  if (ids.length) {
    const { data: lines, error: lErr } = await supabase
      .from('budget_lines').select('budget_id, amount').in('budget_id', ids);
    if (lErr) return { data: null, error: lErr };
    totals = (lines || []).reduce((m, l) => {
      m[l.budget_id] = (m[l.budget_id] || 0) + Number(l.amount || 0); return m;
    }, {});
  }
  return { data: (budgets || []).map((b) => ({ ...b, budgeted_total: totals[b.id] || 0 })), error: null };
};

export const getBudget = async (id) => {
  const { data, error } = await supabase.from('budgets').select(BUDGET_SELECT).eq('id', id).single();
  return { data, error };
};

export const createBudget = async (payload) => {
  const created_by = await currentUserId();
  const { data, error } = await supabase.from('budgets').insert({
    tenant_id: payload.tenant_id,
    name: payload.name,
    period_start: payload.period_start,
    period_end: payload.period_end,
    currency: payload.currency || 'EUR',
    notes: payload.notes || null,
    created_by,
  }).select(BUDGET_SELECT).single();
  return { data, error };
};

export const updateBudget = async (id, patch) => {
  const allowed = ['name', 'period_start', 'period_end', 'currency', 'status', 'notes'];
  const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
  const { data, error } = await supabase.from('budgets').update(clean).eq('id', id).select(BUDGET_SELECT).single();
  return { data, error };
};

export const closeBudget = async (id) => updateBudget(id, { status: 'closed' });

// ── Lines ──────────────────────────────────────────────────────────────────────

export const listLines = async (budgetId) => {
  const { data, error } = await supabase
    .from('budget_lines').select(LINE_SELECT)
    .eq('budget_id', budgetId)
    .order('bucket', { ascending: true }).order('category', { ascending: true });
  return { data, error };
};

export const upsertLine = async (payload) => {
  if (payload.id) {
    const { data, error } = await supabase.from('budget_lines').update({
      bucket: payload.bucket, category: payload.category, code: payload.code || null,
      kind: payload.kind || 'expense', amount: payload.amount, notes: payload.notes || null,
    }).eq('id', payload.id).select(LINE_SELECT).single();
    return { data, error };
  }
  const { data, error } = await supabase.from('budget_lines').insert({
    budget_id: payload.budget_id, bucket: payload.bucket, category: payload.category,
    code: payload.code || null, kind: payload.kind || 'expense',
    amount: payload.amount ?? 0, notes: payload.notes || null,
  }).select(LINE_SELECT).single();
  return { data, error };
};

export const deleteLine = async (id) => {
  const { error } = await supabase.from('budget_lines').delete().eq('id', id);
  return { error };
};

// Inline edit: update only the budgeted amount, leaving code/kind/category/notes.
export const updateLineAmount = async (id, amount) => {
  const { data, error } = await supabase
    .from('budget_lines').update({ amount: Number(amount) || 0 })
    .eq('id', id).select(LINE_SELECT).single();
  return { data, error };
};

// Seed the standard yacht (MYBA) chart of accounts onto a budget. Idempotent —
// existing (bucket, category) lines are left untouched (ON CONFLICT DO NOTHING).
export const seedStandardTemplate = async (budgetId, chart) => {
  const rows = (chart || []).map((c) => ({
    budget_id: budgetId, bucket: c.bucket, category: c.category,
    code: c.code || null, kind: c.kind || 'expense', amount: 0,
  }));
  if (!rows.length) return { data: null, error: null };
  const { data, error } = await supabase
    .from('budget_lines')
    .upsert(rows, { onConflict: 'budget_id,bucket,category', ignoreDuplicates: true })
    .select(LINE_SELECT);
  return { data, error };
};

// ── Actual & committed (read-side aggregation) ──────────────────────────────────

// Actual spend by category within the period: negative ledger amounts made positive,
// in the reporting basis (amount_base), excluding voided rows.
const fetchActualByCategory = async (tenantId, from, to) => {
  const { data, error } = await supabase
    .from('ledger_transactions')
    .select('category, amount, amount_base, status, txn_date')
    .eq('tenant_id', tenantId)
    .gte('txn_date', from).lte('txn_date', to)
    .lt('amount', 0).neq('status', 'void');
  if (error) return { data: null, error };
  const rows = (data || []).map((t) => ({ category: t.category, amount: -Number(t.amount_base || 0) }));
  return { data: rows, error: null };
};

// Income by category within the period: positive ledger amounts (money IN), for
// the revenue-kind budget lines.
const fetchIncomeByCategory = async (tenantId, from, to) => {
  const { data, error } = await supabase
    .from('ledger_transactions')
    .select('category, amount_base, amount, status, txn_date')
    .eq('tenant_id', tenantId)
    .gte('txn_date', from).lte('txn_date', to)
    .gt('amount', 0).neq('status', 'void');
  if (error) return { data: null, error };
  const rows = (data || []).map((t) => ({ category: t.category, amount: Number(t.amount_base || 0) }));
  return { data: rows, error: null };
};

// Committed by category from open supplier orders (not draft, not paid), attributed
// to the period by order created_at. Line value = COALESCE(agreed, quoted, estimated)
// * quantity (VAT-exclusive — the same gross basis the app shows as an order total).
// Phase 1 assumes budget currency = order currency (fx deferred, as in Phase 0).
const fetchCommittedByCategory = async (tenantId, from, to) => {
  const { data, error } = await supabase
    .from('supplier_order_items')
    .select('category, quantity, agreed_price, quoted_price, estimated_price, supplier_orders!inner(status, created_at, tenant_id)')
    .eq('supplier_orders.tenant_id', tenantId)
    .not('supplier_orders.status', 'in', `(${NON_COMMITTED_STATUSES.join(',')})`)
    .gte('supplier_orders.created_at', from)
    .lt('supplier_orders.created_at', `${addDay(to)}T00:00:00Z`);
  if (error) return { data: null, error };
  const rows = (data || []).map((it) => {
    const unit = Number(it.agreed_price ?? it.quoted_price ?? it.estimated_price) || 0;
    return { category: it.category || 'Uncategorised', amount: unit * (Number(it.quantity) || 0) };
  });
  return { data: rows, error: null };
};

// The core call: one budget's full vs-actual view.
export const getBudgetVsActual = async (budgetId) => {
  const { data: budget, error: bErr } = await getBudget(budgetId);
  if (bErr) return { data: null, error: bErr };

  const [{ data: lines, error: lErr }, actualRes, committedRes, incomeRes] = await Promise.all([
    listLines(budgetId),
    fetchActualByCategory(budget.tenant_id, budget.period_start, budget.period_end),
    fetchCommittedByCategory(budget.tenant_id, budget.period_start, budget.period_end),
    fetchIncomeByCategory(budget.tenant_id, budget.period_start, budget.period_end),
  ]);
  if (lErr) return { data: null, error: lErr };
  if (actualRes.error) return { data: null, error: actualRes.error };
  if (committedRes.error) return { data: null, error: committedRes.error };
  if (incomeRes.error) return { data: null, error: incomeRes.error };

  const view = computeVsActual(lines || [], actualRes.data, committedRes.data, incomeRes.data);
  return { data: { budget, ...view }, error: null };
};

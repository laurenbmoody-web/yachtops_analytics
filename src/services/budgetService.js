// Cargo Accounts — Phase 1. Data access for budgets + budget_lines, and the
// live budget-vs-actual assembly. Same conventions as financeService.js:
// { data, error } (never throws), explicit columns, tenant-scoped.

import { supabase } from '../lib/supabaseClient';
import { computeVsActual } from './budgetCalc.js';
import { classifySpend } from './budgetClassify.js';
import { computeMonthly, monthsInPeriod } from './budgetMonthly.js';
import { priorPeriodOf } from './budgetSeed.js';

const BUDGET_SELECT =
  'id, tenant_id, name, period_start, period_end, currency, status, notes, created_by, created_at, updated_at';
const LINE_SELECT = 'id, budget_id, bucket, code, kind, category, amount, monthly, notes, created_at, updated_at';

const normKey = (s) => String(s ?? '').trim().toLowerCase();

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

// Set a line's per-month budget targets. Zero/blank months are dropped from the map
// so it stays tidy; the annual `amount` is kept in sync as the sum of the months.
export const updateLineMonthly = async (id, monthlyMap) => {
  const clean = {};
  Object.entries(monthlyMap || {}).forEach(([ym, v]) => { const n = Number(v); if (n) clean[ym] = Math.round(n * 100) / 100; });
  const amount = Math.round(Object.values(clean).reduce((s, v) => s + v, 0) * 100) / 100;
  const { data, error } = await supabase
    .from('budget_lines').update({ monthly: clean, amount })
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

// ── Guided create — seed a new budget from last season's actuals ────────────────

// Prior-season spend, resolved onto a chart's categories, for seeding a new budget.
// Returns dated rows [{ category (resolved), amount, ym }] the client feeds to
// computeSeed so per-line uplift edits recompute instantly with no round-trip.
export const getSeedSource = async (tenantId, chart, priorFrom, priorTo) => {
  if (!tenantId) return { data: null, error: new Error('No active tenant') };
  const [ledgerRes, ovRes] = await Promise.all([
    supabase.from('ledger_transactions')
      .select('category, amount, amount_base, status, txn_date')
      .eq('tenant_id', tenantId)
      .gte('txn_date', priorFrom).lte('txn_date', priorTo)
      .lt('amount', 0).neq('status', 'void'),
    listCategoryOverrides(tenantId),
  ]);
  if (ledgerRes.error) return { data: null, error: ledgerRes.error };

  const lineCatSet = new Set((chart || []).map((c) => normKey(c.category)));
  const resolve = buildResolver(ovRes.data, lineCatSet);
  const rows = (ledgerRes.data || [])
    .map((t) => ({
      category: resolve({ category: t.category }),
      amount: -Number(t.amount_base || 0),
      ym: String(t.txn_date || '').slice(0, 7),
    }))
    .filter((r) => r.ym && r.amount);
  const total = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  return { data: { rows, total, hasData: rows.length > 0, priorFrom, priorTo }, error: null };
};

// Convenience: seed source for the season one year before the given period.
export const getSeedSourceForPeriod = async (tenantId, chart, periodStart, periodEnd) => {
  const { from, to } = priorPeriodOf(periodStart, periodEnd);
  return getSeedSource(tenantId, chart, from, to);
};

// Create a budget and, in one go, insert its lines (the MYBA chart, optionally seeded
// with amounts + per-month shape + a per-line reason note). `lines` is the final
// proposal the create screen previewed — [{ bucket, category, code, kind, amount,
// monthly, reason }]. Blank-chart create passes no lines.
export const createBudgetGuided = async ({ tenant_id, name, period_start, period_end, currency, lines }) => {
  const { data: budget, error } = await createBudget({ tenant_id, name, period_start, period_end, currency });
  if (error) return { data: null, error };
  if (lines && lines.length) {
    const rows = lines.map((l) => {
      const monthly = {};
      Object.entries(l.monthly || {}).forEach(([ym, v]) => { const n = Number(v); if (n) monthly[ym] = Math.round(n * 100) / 100; });
      return {
        budget_id: budget.id, bucket: l.bucket, category: l.category,
        code: l.code || null, kind: l.kind || 'expense',
        amount: Number(l.amount) || 0, monthly,
        notes: (l.reason || l.notes || '').trim() || null,
      };
    });
    const { error: lErr } = await supabase.from('budget_lines')
      .upsert(rows, { onConflict: 'budget_id,bucket,category', ignoreDuplicates: false });
    if (lErr) return { data: budget, error: lErr };
  }
  return { data: budget, error: null };
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
    .select('category, department, quantity, agreed_price, quoted_price, estimated_price, ' +
      'supplier_orders!inner(status, created_at, tenant_id, supplier_name, provisioning_lists:list_id(title, department, trip_id))')
    .eq('supplier_orders.tenant_id', tenantId)
    .not('supplier_orders.status', 'in', `(${NON_COMMITTED_STATUSES.join(',')})`)
    .gte('supplier_orders.created_at', from)
    .lt('supplier_orders.created_at', `${addDay(to)}T00:00:00Z`);
  if (error) return { data: null, error };

  // Resolve trip name/type for the boards referenced, for the classifier's context.
  const tripIds = [...new Set((data || [])
    .map((it) => it.supplier_orders?.provisioning_lists?.trip_id).filter(Boolean))];
  let tripsById = {};
  if (tripIds.length) {
    const { data: trips } = await supabase
      .from('trips').select('id, name, trip_type').in('id', tripIds);
    tripsById = Object.fromEntries((trips || []).map((t) => [t.id, t]));
  }

  const rows = (data || []).map((it) => {
    const unit = Number(it.agreed_price ?? it.quoted_price ?? it.estimated_price) || 0;
    const board = it.supplier_orders?.provisioning_lists;
    const trip = board?.trip_id ? tripsById[board.trip_id] : null;
    return {
      category: it.category || 'Uncategorised',
      amount: unit * (Number(it.quantity) || 0),
      department: it.department || board?.department || null,
      boardTitle: board?.title || null,
      tripName: trip?.name || null,
      tripType: trip?.trip_type || null,
    };
  });
  return { data: rows, error: null };
};

// ── Learned category mapping (source category -> budget line) ────────────────────

export const listCategoryOverrides = async (tenantId) => {
  const { data, error } = await supabase
    .from('budget_category_map')
    .select('source_category, bucket, category, code')
    .eq('tenant_id', tenantId);
  return { data, error };
};

export const setCategoryOverride = async (tenantId, sourceCategory, target) => {
  const created_by = await currentUserId();
  const { data, error } = await supabase
    .from('budget_category_map')
    .upsert({
      tenant_id: tenantId,
      source_category: normKey(sourceCategory),
      bucket: target.bucket, category: target.category, code: target.code || null,
      created_by,
    }, { onConflict: 'tenant_id,source_category' })
    .select('source_category, bucket, category, code')
    .single();
  return { data, error };
};

export const clearCategoryOverride = async (tenantId, sourceCategory) => {
  const { error } = await supabase
    .from('budget_category_map')
    .delete().eq('tenant_id', tenantId).eq('source_category', normKey(sourceCategory));
  return { error };
};

// Route a source spend item to a budget line category: learned override first, then
// a HIGH-confidence classifier guess that lands on an existing line, else leave the
// source category untouched so it surfaces in the Unbudgeted review queue.
const buildResolver = (overrides, lineCatSet) => {
  const map = new Map((overrides || []).map((o) => [normKey(o.source_category), o]));
  return (item) => {
    const ov = map.get(normKey(item.category));
    if (ov && lineCatSet.has(normKey(ov.category))) return ov.category;
    const s = classifySpend(item);
    if (s && s.confidence === 'high' && lineCatSet.has(normKey(s.category))) return s.category;
    return item.category;
  };
};

// The core call: one budget's full vs-actual view.
export const getBudgetVsActual = async (budgetId) => {
  const { data: budget, error: bErr } = await getBudget(budgetId);
  if (bErr) return { data: null, error: bErr };

  const [{ data: lines, error: lErr }, actualRes, committedRes, incomeRes, ovRes] = await Promise.all([
    listLines(budgetId),
    fetchActualByCategory(budget.tenant_id, budget.period_start, budget.period_end),
    fetchCommittedByCategory(budget.tenant_id, budget.period_start, budget.period_end),
    fetchIncomeByCategory(budget.tenant_id, budget.period_start, budget.period_end),
    listCategoryOverrides(budget.tenant_id),
  ]);
  if (lErr) return { data: null, error: lErr };
  if (actualRes.error) return { data: null, error: actualRes.error };
  if (committedRes.error) return { data: null, error: committedRes.error };
  if (incomeRes.error) return { data: null, error: incomeRes.error };

  // Route source spend onto budget lines (learned map + confident classifier); the
  // rest keeps its own category and lands in Unbudgeted for review.
  const lineCatSet = new Set((lines || []).map((l) => normKey(l.category)));
  const resolve = buildResolver(ovRes.data, lineCatSet);
  const actualResolved = (actualRes.data || []).map((r) => ({ ...r, category: resolve(r) }));
  const committedResolved = (committedRes.data || []).map((r) => ({ ...r, category: resolve(r) }));

  const view = computeVsActual(lines || [], actualResolved, committedResolved, incomeRes.data);
  return { data: { budget, ...view }, error: null };
};

// Month-by-month actuals matrix (Jan–Dec + cumulative), the owner's-office layout.
// Actuals only (on-order is a summary-view concept); spend and income are dated by
// txn_date and routed to lines with the same resolver as the summary.
export const getBudgetMonthly = async (budgetId) => {
  const { data: budget, error: bErr } = await getBudget(budgetId);
  if (bErr) return { data: null, error: bErr };

  const [{ data: lines, error: lErr }, ledgerRes, ovRes] = await Promise.all([
    listLines(budgetId),
    supabase.from('ledger_transactions')
      .select('category, amount, amount_base, status, txn_date')
      .eq('tenant_id', budget.tenant_id)
      .gte('txn_date', budget.period_start).lte('txn_date', budget.period_end)
      .neq('status', 'void'),
    listCategoryOverrides(budget.tenant_id),
  ]);
  if (lErr) return { data: null, error: lErr };
  if (ledgerRes.error) return { data: null, error: ledgerRes.error };

  const lineCatSet = new Set((lines || []).map((l) => normKey(l.category)));
  const resolve = buildResolver(ovRes.data, lineCatSet);
  const spend = []; const income = [];
  (ledgerRes.data || []).forEach((t) => {
    const ym = String(t.txn_date || '').slice(0, 7);
    if (!ym) return;
    const category = resolve({ category: t.category });
    const base = Number(t.amount_base || 0);
    if (Number(t.amount) < 0) spend.push({ category, amount: -base, ym });
    else if (Number(t.amount) > 0) income.push({ category, amount: base, ym });
  });

  const months = monthsInPeriod(budget.period_start, budget.period_end);
  const monthly = computeMonthly(lines || [], spend, income, months);
  return { data: { budget, ...monthly }, error: null };
};

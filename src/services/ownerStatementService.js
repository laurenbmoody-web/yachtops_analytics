// Cargo Accounts — Phase 3. Owner-statement data access + assembly.
//
// Assembles the statement in JS from the SAME budget services the Budgets page
// uses (getBudgetVsActual / getBudgetMonthly / computeOverview) so the owner
// numbers can never drift from what Budgets shows. Persists drafts and freezes a
// snapshot on issue. Conventions match financeService: { data, error }.

import { supabase } from '../lib/supabaseClient';
import { currentUserId } from './financeService.js';
import { formatMoney } from './financeCalc.js';
import { getBudgetVsActualForPeriod, getBudgetVsActual, getBudgetMonthly } from './budgetService.js';
import { buildStatement, buildNarrative } from './ownerStatement.js';

const STMT_SELECT =
  'id, tenant_id, title, period_start, period_end, currency, status, snapshot, note, ' +
  'issued_at, issued_by, created_by, created_at, updated_at';

// The budget that best covers a period: newest one overlapping [start,end].
async function findBudgetForPeriod(tenantId, periodStart, periodEnd) {
  const { data, error } = await supabase
    .from('budgets')
    .select('id, name, period_start, period_end, currency, tenant_id')
    .eq('tenant_id', tenantId)
    .lte('period_start', periodEnd)
    .gte('period_end', periodStart)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return { data: null, error };
  return { data: data?.[0] || null, error: null };
}

// Compute (not persist) the statement for a period, reusing budget aggregations.
// meta carries vessel name / title / statement date supplied by the caller.
export async function generateStatementData(tenantId, periodStart, periodEnd, meta = {}) {
  if (!tenantId || !periodStart || !periodEnd) return { data: null, error: new Error('Period required') };
  const { data: budget, error: bErr } = await findBudgetForPeriod(tenantId, periodStart, periodEnd);
  if (bErr) return { data: null, error: bErr };

  const currency = meta.currency || budget?.currency || 'EUR';
  const baseMeta = {
    title: meta.title || 'Owner Statement',
    vessel: meta.vessel || null,
    periodStart, periodEnd,
    statementDate: meta.statementDate || new Date().toISOString().slice(0, 10),
    currency,
  };

  if (!budget) {
    // No budget covers this period — return an empty-but-valid statement so the UI
    // can show the position shell and prompt to create a budget.
    return { data: { ...buildStatement({ meta: baseMeta, view: {}, overview: {} }), noBudget: true }, error: null };
  }

  // Period-scoped position/table/narrative + the full-season view & monthly for
  // the visuals (burn-down / risk / seasonal are inherently season-level).
  const [vaRes, seasonRes, monthlyRes] = await Promise.all([
    getBudgetVsActualForPeriod(budget.id, periodStart, periodEnd),
    getBudgetVsActual(budget.id),
    getBudgetMonthly(budget.id),
  ]);
  if (vaRes.error) return { data: null, error: vaRes.error };

  const fmt = (n) => formatMoney(n, currency);
  const narrative = buildNarrative(vaRes.data, fmt);
  const statement = buildStatement({ meta: baseMeta, view: vaRes.data, narrative, note: meta.note });
  const season = (!seasonRes.error && !monthlyRes.error)
    ? { view: seasonRes.data, monthly: monthlyRes.data, periodStart: budget.period_start, periodEnd: budget.period_end }
    : null;
  return { data: { ...statement, budgetId: budget.id, budgetName: budget.name, season }, error: null };
}

// ── persistence ────────────────────────────────────────────────────────────

export async function listStatements(tenantId) {
  if (!tenantId) return { data: [], error: null };
  const { data, error } = await supabase
    .from('owner_statements')
    .select(STMT_SELECT)
    .eq('tenant_id', tenantId)
    .order('period_end', { ascending: false })
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function getStatement(id) {
  const { data, error } = await supabase.from('owner_statements').select(STMT_SELECT).eq('id', id).single();
  return { data, error };
}

export async function createStatement({ tenantId, title, periodStart, periodEnd, currency, note }) {
  const created_by = await currentUserId();
  const { data, error } = await supabase
    .from('owner_statements')
    .insert({
      tenant_id: tenantId, title, period_start: periodStart, period_end: periodEnd,
      currency: currency || 'EUR', note: note || null, status: 'draft', created_by,
    })
    .select(STMT_SELECT)
    .single();
  return { data, error };
}

// Freeze the computed statement JSON and mark issued — later ledger edits won't
// change it. Gate to COMMAND at the call site.
export async function issueStatement(id, snapshot) {
  const issued_by = await currentUserId();
  const { data, error } = await supabase
    .from('owner_statements')
    .update({ status: 'issued', snapshot, issued_at: new Date().toISOString(), issued_by })
    .eq('id', id)
    .select(STMT_SELECT)
    .single();
  return { data, error };
}

export async function deleteStatement(id) {
  const { error } = await supabase.from('owner_statements').delete().eq('id', id);
  return { error };
}

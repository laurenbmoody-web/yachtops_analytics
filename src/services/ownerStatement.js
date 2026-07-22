// Cargo Accounts — Phase 3. Pure owner-statement shaper (no Supabase), so it is
// unit-testable. Takes the budget vs-actual view + the derived overview (both
// already computed by the budget services) and folds them into the sections an
// owner statement renders / snapshots. No new calculation — presentation only.
//
// Charter summary (Phase 2) is intentionally absent until Charter/APA is built;
// buildStatement leaves `charter: null` so the statement is complete on that axis
// the moment the Phase 2 aggregation lands.

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (n) => Math.round(num(n) * 100) / 100;

// meta:    { title, vessel, periodStart, periodEnd, statementDate, currency }
// view:    getBudgetVsActual result — { buckets, unbudgeted, totals, revenueTotals, net }
// overview: computeOverview result — { projectedTotal, projectedOver, insights, ... }
// note:    free text
export function buildStatement({ meta = {}, view = {}, overview = {}, note = '' }) {
  const totals = view.totals || {};
  const revenue = view.revenueTotals || {};

  const position = {
    budget: r2(totals.budgeted),
    actual: r2(totals.actual),
    committed: r2(totals.committed),
    remaining: r2(totals.remaining),
    forecast: r2(overview.projectedTotal),          // forecast expenditure to period end
    forecastOver: r2(overview.projectedOver),        // + = over budget on run-rate
    revenueBudget: r2(revenue.budgeted),
    revenueActual: r2(revenue.actual),
    // net revenue/(expenditure): positive = surplus. view.net already computes it;
    // fall back to revenue.actual - totals.actual if absent.
    net: view.net != null ? r2(view.net) : r2(num(revenue.actual) - num(totals.actual)),
  };

  // Budget vs actual by bucket — expenditure buckets + any unbudgeted, revenue kept
  // separate so an owner reads spend and income distinctly.
  const bucketRow = (b) => ({
    bucket: b.bucket,
    kind: b.kind,
    budget: r2(b.subtotal?.budgeted),
    actual: r2(b.subtotal?.actual),
    committed: r2(b.subtotal?.committed),
    variance: r2(num(b.subtotal?.budgeted) - num(b.subtotal?.actual) - num(b.subtotal?.committed)),
    pctUsed: b.subtotal?.pct != null ? b.subtotal.pct : null,
  });
  const expenseBuckets = (view.buckets || []).filter((b) => b.kind !== 'revenue').map(bucketRow);
  if (view.unbudgeted?.lines?.length) expenseBuckets.push(bucketRow(view.unbudgeted));
  const revenueBuckets = (view.buckets || []).filter((b) => b.kind === 'revenue').map(bucketRow);

  return {
    header: {
      title: meta.title || 'Owner Statement',
      vessel: meta.vessel || null,
      periodStart: meta.periodStart || null,
      periodEnd: meta.periodEnd || null,
      statementDate: meta.statementDate || null,
      currency: meta.currency || 'EUR',
    },
    position,
    expenseBuckets,
    revenueBuckets,
    charter: null, // Phase 2 — added when Charter/APA lands
    narrative: (overview.insights || []).map((i) => ({ sev: i.sev, text: i.text })),
    note: note || '',
  };
}

// A short one-line headline for a statement list row.
export function statementHeadline(position, currency = 'EUR') {
  const p = position || {};
  const net = num(p.net);
  const sign = net >= 0 ? 'surplus' : 'deficit';
  return `Net ${sign} · ${num(p.actual).toLocaleString('en-GB')} spent of ${num(p.budget).toLocaleString('en-GB')} ${currency}`;
}

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

// Plain-language "where it needs eyes" callouts for a PERIOD's vs-actual — pure,
// currency-formatted via the passed fmt. Used for period statements where the
// full-season pace/forecast narrative doesn't apply.
export function buildNarrative(view = {}, fmt = (n) => String(Math.round(n))) {
  const out = [];
  const buckets = (view.buckets || []).filter((b) => b.kind !== 'revenue');
  const over = buckets
    .map((b) => {
      const s = b.subtotal || {};
      const used = num(s.actual) + num(s.committed);
      return { name: b.bucket, over: used - num(s.budgeted), pct: num(s.budgeted) > 0 ? used / num(s.budgeted) : null };
    })
    .filter((x) => x.over > 0.005)
    .sort((a, b) => b.over - a.over);
  over.slice(0, 3).forEach((x, i) => out.push({
    sev: i === 0 ? 'crit' : 'warn',
    text: `${x.name} is over by ${fmt(x.over)}${x.pct != null ? ` — ${Math.round(x.pct * 100)}% used` : ''}.`,
  }));
  const t = view.totals || {};
  if (num(t.remaining) > 0) out.push({ sev: 'info', text: `${fmt(num(t.remaining))} still uncommitted this period.` });
  const net = view.net != null ? num(view.net) : 0;
  out.push({ sev: net >= 0 ? 'good' : 'warn', text: `Net ${net >= 0 ? 'surplus' : 'deficit'} of ${fmt(Math.abs(net))} for the period.` });
  return out;
}

// meta:    { title, vessel, periodStart, periodEnd, statementDate, currency }
// view:    (period) budget vs-actual — { buckets, unbudgeted, totals, revenueTotals, net }
// narrative: pre-built callouts (buildNarrative); falls back to overview.insights
// overview: optional computeOverview result — { projectedTotal, projectedOver, insights }
// note:    free text
export function buildStatement({ meta = {}, view = {}, overview = {}, narrative = null, note = '' }) {
  const totals = view.totals || {};
  const revenue = view.revenueTotals || {};
  const hasForecast = overview && overview.projectedTotal != null;

  const position = {
    budget: r2(totals.budgeted),
    actual: r2(totals.actual),
    committed: r2(totals.committed),
    remaining: r2(totals.remaining),
    forecast: hasForecast ? r2(overview.projectedTotal) : null,   // expenditure to period end (full-season only)
    forecastOver: hasForecast ? r2(overview.projectedOver) : null,
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
    narrative: (narrative && narrative.length ? narrative : (overview.insights || [])).map((i) => ({ sev: i.sev, text: i.text })),
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

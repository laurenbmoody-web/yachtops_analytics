// Cargo Accounts — Phase 1.5. Insight-overview maths (pure, no imports).
//
// Turns the summary vs-actual (view) + the monthly matrix (monthly) into the pieces
// the Overview tab renders: a pace/forecast burn-down, category-risk bars, a seasonal
// heatmap and plain-language callouts. All derived — no new data.

const r2 = (n) => Math.round(n * 100) / 100;
const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const cum = (arr) => { let s = 0; return arr.map((v) => (s = r2(s + num(v)))); };

// todayYm: 'YYYY-MM'. Returns the count of period months elapsed (0..n).
const elapsedMonths = (months, todayYm) => {
  if (!months.length) return 0;
  if (!todayYm) return months.length;
  if (todayYm < months[0].ym) return 0;
  if (todayYm > months[months.length - 1].ym) return months.length;
  const i = months.findIndex((m) => m.ym === todayYm);
  return i === -1 ? months.length : i + 1;
};

export const computeOverview = (view, monthly, todayYm) => {
  const months = (monthly && monthly.months) || [];
  const n = months.length;

  const plannedM = months.map((m) => num(monthly.budgetExpenseByMonth[m.ym]));
  const actualM = months.map((m) => num(monthly.expenseByMonth[m.ym]));
  const plannedCum = cum(plannedM);
  const actualCumFull = cum(actualM);

  const elapsed = elapsedMonths(months, todayYm);
  const actualCum = actualCumFull.slice(0, elapsed); // only up to "today"

  // Run-rate forecast: average of the last up-to-3 elapsed months, projected forward.
  const recent = actualM.slice(Math.max(0, elapsed - 3), elapsed);
  const runRate = recent.length ? r2(recent.reduce((a, b) => a + b, 0) / recent.length) : 0;
  const forecast = []; // [{ ym, value }] from today's point to period end
  let last = elapsed > 0 ? actualCum[elapsed - 1] : 0;
  for (let i = Math.max(0, elapsed - 1); i < n; i++) {
    if (i === elapsed - 1) forecast.push({ ym: months[i].ym, value: last });
    else { last = r2(last + runRate); forecast.push({ ym: months[i].ym, value: last }); }
  }
  const projectedTotal = forecast.length ? forecast[forecast.length - 1].value : (elapsed > 0 ? actualCum[elapsed - 1] : 0);

  const annualBudget = num(view?.totals?.budgeted) || (plannedCum.length ? plannedCum[n - 1] : 0);
  const spent = num(view?.totals?.actual);
  const onOrder = num(view?.totals?.committed);
  const used = r2(spent + onOrder);
  const remaining = r2(annualBudget - used);
  const projectedOver = r2(projectedTotal - annualBudget);
  const pctYear = n ? elapsed / n : 0;
  const pctUsed = annualBudget > 0 ? used / annualBudget : null;

  // Category-risk bars — expense buckets, sorted by % used (hottest first).
  const scaleBase = Math.max(1, ...(view?.buckets || []).filter((b) => b.kind !== 'revenue')
    .map((b) => Math.max(num(b.subtotal.budgeted), num(b.subtotal.actual) + num(b.subtotal.committed))));
  const categories = (view?.buckets || []).filter((b) => b.kind !== 'revenue').map((b) => {
    const budget = num(b.subtotal.budgeted); const sp = num(b.subtotal.actual); const oo = num(b.subtotal.committed);
    const u = r2(sp + oo);
    return { name: b.bucket, budget, spent: sp, onOrder: oo, used: u, pct: budget > 0 ? u / budget : null, over: budget > 0 && u > budget, scaleBase };
  }).sort((a, b) => (b.pct == null ? -1 : b.pct) - (a.pct == null ? -1 : a.pct));

  // Seasonal heatmap — expense buckets × months, actual vs that month's plan.
  const heat = (monthly?.buckets || []).filter((b) => b.kind !== 'revenue').map((b) => ({
    name: b.bucket,
    peak: Math.max(1, ...months.map((m) => num(b.subtotalByMonth[m.ym]))),
    cells: months.map((m, i) => ({
      ym: m.ym, label: m.label, value: num(b.subtotalByMonth[m.ym]),
      plan: num(b.budgetSubtotalByMonth[m.ym]), elapsed: i < elapsed,
    })),
  }));

  // Callouts.
  const insights = [];
  categories.filter((c) => c.over).slice(0, 2).forEach((c, i) => {
    insights.push({ sev: i === 0 ? 'crit' : 'warn', text: `${c.name} is over budget by ${Math.round(c.used - c.budget)} — ${Math.round(c.pct * 100)}% used.` });
  });
  if (pctUsed != null) {
    if (projectedOver > annualBudget * 0.01) insights.push({ sev: 'warn', text: `On this run-rate you'll finish ~${Math.round(projectedOver)} over budget.` });
    else if (pctUsed <= pctYear + 0.02) insights.push({ sev: 'good', text: `On plan — ${Math.round(pctUsed * 100)}% used at ${Math.round(pctYear * 100)}% through the period.` });
  }
  if (remaining > 0) insights.push({ sev: 'info', text: `${Math.round(remaining)} still uncommitted.` });

  return {
    months, elapsed, plannedCum, actualCum, forecast, projectedTotal, projectedOver,
    annualBudget, spent, onOrder, used, remaining, pctYear, pctUsed,
    categories, heat, insights,
    revenue: num(view?.revenueTotals?.actual), net: num(view?.net?.actual),
    hasRevenue: (num(view?.revenueTotals?.budgeted) > 0 || num(view?.revenueTotals?.actual) > 0),
  };
};

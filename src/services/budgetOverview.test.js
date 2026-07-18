// Cargo Accounts — Phase 1.5. Insight-overview maths tests. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOverview } from './budgetOverview.js';

const months = [
  { ym: '2026-01', label: 'Jan' }, { ym: '2026-02', label: 'Feb' },
  { ym: '2026-03', label: 'Mar' }, { ym: '2026-04', label: 'Apr' },
];

// A 4-month period, 1000 planned/month = 4000/yr. Actual: 1200, 1200, 1200 for
// the first three months (over pace), April not yet spent.
const monthly = {
  months,
  budgetExpenseByMonth: { '2026-01': 1000, '2026-02': 1000, '2026-03': 1000, '2026-04': 1000 },
  expenseByMonth: { '2026-01': 1200, '2026-02': 1200, '2026-03': 1200, '2026-04': 0 },
  buckets: [
    { bucket: 'Fuel', kind: 'expense',
      subtotalByMonth: { '2026-01': 1200, '2026-02': 1200, '2026-03': 1200, '2026-04': 0 },
      budgetSubtotalByMonth: { '2026-01': 1000, '2026-02': 1000, '2026-03': 1000, '2026-04': 1000 } },
  ],
};
const view = {
  totals: { budgeted: 4000, actual: 3600, committed: 200 },
  revenueTotals: { budgeted: 0, actual: 0 },
  net: { actual: -3600 },
  buckets: [
    { bucket: 'Fuel', kind: 'expense', subtotal: { budgeted: 3000, actual: 3600, committed: 200 } },
    { bucket: 'Guest', kind: 'expense', subtotal: { budgeted: 1000, actual: 0, committed: 0 } },
  ],
};

test('cumulative planned and actual-to-date track the right points', () => {
  const o = computeOverview(view, monthly, '2026-03');
  assert.deepEqual(o.plannedCum, [1000, 2000, 3000, 4000]);
  assert.equal(o.elapsed, 3);
  assert.deepEqual(o.actualCum, [1200, 2400, 3600]); // only up to March
});

test('run-rate forecast projects the last-3-month average forward', () => {
  const o = computeOverview(view, monthly, '2026-03');
  // avg of Jan-Mar = 1200/mo; from 3600 at end of Mar, April -> 4800.
  const end = o.forecast[o.forecast.length - 1];
  assert.equal(end.ym, '2026-04');
  assert.equal(end.value, 4800);
  assert.equal(o.projectedTotal, 4800);
  assert.equal(o.projectedOver, 800); // 4800 - 4000
});

test('headline totals: used = actual + committed, remaining off annual budget', () => {
  const o = computeOverview(view, monthly, '2026-03');
  assert.equal(o.annualBudget, 4000);
  assert.equal(o.spent, 3600);
  assert.equal(o.onOrder, 200);
  assert.equal(o.used, 3800);
  assert.equal(o.remaining, 200);
  assert.equal(o.pctYear, 0.75); // 3 of 4 months
});

test('category bars: over-budget bucket flagged and sorted hottest-first', () => {
  const o = computeOverview(view, monthly, '2026-03');
  assert.equal(o.categories[0].name, 'Fuel');
  assert.equal(o.categories[0].over, true);
  assert.ok(o.categories[0].pct > 1);
  const guest = o.categories.find((c) => c.name === 'Guest');
  assert.equal(guest.over, false);
});

test('insights call out the over-budget category and the run-rate overspend', () => {
  const o = computeOverview(view, monthly, '2026-03');
  assert.ok(o.insights.some((i) => i.sev === 'crit' && /Fuel/.test(i.text)));
  assert.ok(o.insights.some((i) => /run-rate/.test(i.text)));
});

test('heatmap exposes actual vs plan per bucket per month', () => {
  const o = computeOverview(view, monthly, '2026-03');
  const fuel = o.heat.find((h) => h.name === 'Fuel');
  assert.equal(fuel.cells[0].value, 1200);
  assert.equal(fuel.cells[0].plan, 1000);
  assert.equal(fuel.cells[0].elapsed, true);
  assert.equal(fuel.cells[3].elapsed, false); // April not yet elapsed
});

test('before the period starts nothing is elapsed and forecast spans the whole period', () => {
  const o = computeOverview(view, monthly, '2025-12');
  assert.equal(o.elapsed, 0);
  assert.deepEqual(o.actualCum, []);
  assert.equal(o.forecast.length, months.length);
});

test('a healthy on-pace budget yields a good insight, not an overspend warning', () => {
  const onPaceMonthly = {
    months,
    budgetExpenseByMonth: { '2026-01': 1000, '2026-02': 1000, '2026-03': 1000, '2026-04': 1000 },
    expenseByMonth: { '2026-01': 900, '2026-02': 900, '2026-03': 900, '2026-04': 0 },
    buckets: [],
  };
  const onPaceView = {
    totals: { budgeted: 4000, actual: 2700, committed: 0 },
    revenueTotals: { budgeted: 0, actual: 0 }, net: { actual: -2700 },
    buckets: [{ bucket: 'Fuel', kind: 'expense', subtotal: { budgeted: 4000, actual: 2700, committed: 0 } }],
  };
  const o = computeOverview(onPaceView, onPaceMonthly, '2026-03');
  assert.ok(o.insights.some((i) => i.sev === 'good'));
  assert.ok(!o.insights.some((i) => /run-rate/.test(i.text)));
});

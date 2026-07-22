// Cargo Accounts — owner-statement shaper tests. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStatement, statementHeadline, buildNarrative } from './ownerStatement.js';

const view = {
  totals: { budgeted: 100000, actual: 62000, committed: 8000, remaining: 30000, pct: 0.7 },
  revenueTotals: { budgeted: 200000, actual: 180000, committed: 0, remaining: 20000, pct: 0.9 },
  net: 118000,
  buckets: [
    { bucket: 'Revenue', kind: 'revenue', subtotal: { budgeted: 200000, actual: 180000, committed: 0, remaining: 20000, pct: 0.9 } },
    { bucket: 'Crew Cost', kind: 'expense', subtotal: { budgeted: 60000, actual: 40000, committed: 5000, remaining: 15000, pct: 0.75 } },
    { bucket: 'Fuel', kind: 'expense', subtotal: { budgeted: 40000, actual: 22000, committed: 3000, remaining: 15000, pct: 0.625 } },
  ],
  unbudgeted: { bucket: 'Unbudgeted', kind: 'expense', lines: [{ category: 'Sundry' }], subtotal: { budgeted: 0, actual: 1200, committed: 0, remaining: -1200, pct: null } },
};
const overview = { projectedTotal: 96000, projectedOver: -4000, insights: [
  { sev: 'warn', text: 'Fuel is over budget by €2,000 — 105% used.' },
  { sev: 'good', text: 'On plan — 62% used at 60% through the period.' },
] };

test('position summary maps from totals + overview', () => {
  const s = buildStatement({ meta: { currency: 'EUR' }, view, overview });
  assert.equal(s.position.budget, 100000);
  assert.equal(s.position.actual, 62000);
  assert.equal(s.position.remaining, 30000);
  assert.equal(s.position.forecast, 96000);
  assert.equal(s.position.net, 118000);
  assert.equal(s.position.revenueActual, 180000);
});

test('expense buckets exclude revenue and include unbudgeted', () => {
  const s = buildStatement({ view, overview });
  const names = s.expenseBuckets.map((b) => b.bucket);
  assert.ok(names.includes('Crew Cost'));
  assert.ok(names.includes('Fuel'));
  assert.ok(names.includes('Unbudgeted'));
  assert.ok(!names.includes('Revenue'));
});

test('bucket variance = budget - actual - committed', () => {
  const s = buildStatement({ view, overview });
  const crew = s.expenseBuckets.find((b) => b.bucket === 'Crew Cost');
  assert.equal(crew.variance, 60000 - 40000 - 5000);
});

test('revenue buckets kept separate', () => {
  const s = buildStatement({ view, overview });
  assert.equal(s.revenueBuckets.length, 1);
  assert.equal(s.revenueBuckets[0].bucket, 'Revenue');
});

test('narrative carries the overview insights; charter is null until Phase 2', () => {
  const s = buildStatement({ view, overview });
  assert.equal(s.narrative.length, 2);
  assert.equal(s.narrative[0].sev, 'warn');
  assert.equal(s.charter, null);
});

test('net falls back to revenue.actual - totals.actual when view.net absent', () => {
  const s = buildStatement({ view: { ...view, net: undefined }, overview });
  assert.equal(s.position.net, 180000 - 62000);
});

test('buildNarrative flags over-budget buckets and formats with fmt', () => {
  const fmt = (n) => `€${Math.round(n).toLocaleString('en-GB')}`;
  const n = buildNarrative({
    buckets: [
      { bucket: 'Fuel', kind: 'expense', subtotal: { budgeted: 10000, actual: 12000, committed: 0 } },
      { bucket: 'Deck', kind: 'expense', subtotal: { budgeted: 5000, actual: 2000, committed: 0 } },
    ],
    totals: { budgeted: 15000, actual: 14000, committed: 0, remaining: 1000 },
    net: -3000,
  }, fmt);
  assert.equal(n[0].sev, 'crit');
  assert.match(n[0].text, /Fuel is over by €2,000/);
  assert.ok(n.some((x) => /still uncommitted/.test(x.text)));
  assert.ok(n.some((x) => /Net deficit of €3,000/.test(x.text)));
});

test('buildNarrative with nothing over reports a surplus line', () => {
  const n = buildNarrative({ buckets: [{ bucket: 'Deck', kind: 'expense', subtotal: { budgeted: 5000, actual: 2000, committed: 0 } }], totals: { remaining: 3000 }, net: 4000 }, (x) => String(x));
  assert.ok(n.some((x) => x.sev === 'good' && /surplus/.test(x.text)));
});

test('statementHeadline reads surplus/deficit', () => {
  assert.match(statementHeadline({ net: 118000, actual: 62000, budget: 100000 }), /surplus/);
  assert.match(statementHeadline({ net: -5000, actual: 62000, budget: 100000 }), /deficit/);
});

// Cargo Accounts — Phase 1. Budget-vs-actual maths tests. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVsActual, stateOf, normCat } from './budgetCalc.js';

const lines = [
  { id: 'l1', bucket: 'Provisioning', category: 'Galley food', amount: 40000 },
  { id: 'l2', bucket: 'Provisioning', category: 'Beverages', amount: 12000 },
  { id: 'l3', bucket: 'Maintenance', category: 'Engineering', amount: 20000 },
];

test('remaining = budgeted - actual - committed, per line', () => {
  const r = computeVsActual(lines,
    [{ category: 'Galley food', amount: 15000 }],
    [{ category: 'Galley food', amount: 5000 }]);
  const galley = r.buckets[0].lines[0];
  assert.equal(galley.budgeted, 40000);
  assert.equal(galley.actual, 15000);
  assert.equal(galley.committed, 5000);
  assert.equal(galley.remaining, 20000);
  assert.equal(galley.pct, 0.5);
  assert.equal(galley.state, 'under');
});

test('category matching is case/space-insensitive', () => {
  const r = computeVsActual(lines, [{ category: '  BEVERAGES ', amount: 6000 }], []);
  assert.equal(r.buckets[0].lines[1].actual, 6000);
});

test('over-budget line reports over state and negative remaining', () => {
  const r = computeVsActual(lines, [{ category: 'Engineering', amount: 18000 }], [{ category: 'Engineering', amount: 5000 }]);
  const eng = r.buckets[1].lines[0];
  assert.equal(eng.remaining, -3000);
  assert.equal(eng.state, 'over');
  assert.ok(eng.pct > 1);
});

test('bucket subtotals and grand total reconcile to the sum of lines', () => {
  const r = computeVsActual(lines,
    [{ category: 'Galley food', amount: 10000 }, { category: 'Engineering', amount: 1000 }],
    [{ category: 'Beverages', amount: 2000 }]);
  const prov = r.buckets.find((b) => b.bucket === 'Provisioning');
  assert.equal(prov.subtotal.budgeted, 52000);
  assert.equal(prov.subtotal.actual, 10000);
  assert.equal(prov.subtotal.committed, 2000);
  assert.equal(r.totals.budgeted, 72000);
  assert.equal(r.totals.actual, 11000);
  assert.equal(r.totals.committed, 2000);
  assert.equal(r.totals.remaining, 72000 - 11000 - 2000);
});

test('spend with no matching budget line lands in Unbudgeted (nothing hidden)', () => {
  const r = computeVsActual(lines, [{ category: 'Fuel', amount: 9000 }], []);
  assert.ok(r.unbudgeted);
  assert.equal(r.unbudgeted.lines[0].category, 'Fuel');
  assert.equal(r.unbudgeted.lines[0].actual, 9000);
  assert.equal(r.unbudgeted.lines[0].state, 'over');
  assert.equal(r.totals.actual, 9000); // still counted in the grand total
});

test('a category reused under two buckets is not double-counted', () => {
  const dup = [
    { id: 'a', bucket: 'B1', category: 'Shared', amount: 100 },
    { id: 'b', bucket: 'B2', category: 'Shared', amount: 100 },
  ];
  const r = computeVsActual(dup, [{ category: 'Shared', amount: 50 }], []);
  assert.equal(r.totals.actual, 50); // not 100
});

test('paid moves committed -> actual with no change to total spent', () => {
  // before: on order (committed); after: paid (actual). Total (a+c) is stable.
  const before = computeVsActual(lines, [], [{ category: 'Galley food', amount: 8000 }]);
  const after = computeVsActual(lines, [{ category: 'Galley food', amount: 8000 }], []);
  const gBefore = before.buckets[0].lines[0];
  const gAfter = after.buckets[0].lines[0];
  assert.equal(gBefore.remaining, gAfter.remaining); // 40000 - 8000 both ways
  assert.equal(gBefore.committed, 8000);
  assert.equal(gAfter.actual, 8000);
});

test('stateOf thresholds', () => {
  assert.equal(stateOf(100, 50), 'under');
  assert.equal(stateOf(100, 90), 'near');
  assert.equal(stateOf(100, 120), 'over');
  assert.equal(stateOf(0, 10), 'over');
  assert.equal(normCat('  Foo Bar '), 'foo bar');
});

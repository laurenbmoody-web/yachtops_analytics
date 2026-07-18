// Cargo Accounts — Phase 1.3. Monthly matrix tests. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMonthly, monthsInPeriod } from './budgetMonthly.js';

const months = [{ ym: '2026-01', label: 'Jan' }, { ym: '2026-02', label: 'Feb' }];
const lines = [
  { id: 'l1', bucket: 'Fuel', category: 'Fuel & Lube Oil', code: 'FLE', kind: 'expense' },
  { id: 'r1', bucket: 'Revenue', category: 'Net Charter Revenue', code: 'NCR', kind: 'revenue' },
];

test('per-line monthly actuals and cumulative total', () => {
  const r = computeMonthly(lines,
    [{ category: 'Fuel & Lube Oil', amount: 100, ym: '2026-01' }, { category: 'Fuel & Lube Oil', amount: 50, ym: '2026-02' }],
    [], months);
  const fuel = r.buckets.find((b) => b.bucket === 'Fuel').lines[0];
  assert.equal(fuel.byMonth['2026-01'], 100);
  assert.equal(fuel.byMonth['2026-02'], 50);
  assert.equal(fuel.total, 150);
});

test('revenue lines use income; net = revenue - expenditure per month', () => {
  const r = computeMonthly(lines,
    [{ category: 'Fuel & Lube Oil', amount: 100, ym: '2026-01' }],
    [{ category: 'Net Charter Revenue', amount: 1000, ym: '2026-02' }], months);
  assert.equal(r.revenueByMonth['2026-02'], 1000);
  assert.equal(r.expenseByMonth['2026-01'], 100);
  assert.equal(r.netByMonth['2026-01'], -100);
  assert.equal(r.netByMonth['2026-02'], 1000);
  assert.equal(r.netTotal, 900);
});

test('spend with no owning line lands in Other, still counted in expenditure', () => {
  const r = computeMonthly(lines, [{ category: 'Mystery', amount: 9, ym: '2026-01' }], [], months);
  assert.ok(r.other);
  assert.equal(r.other.lines[0].total, 9);
  assert.equal(r.expenseByMonth['2026-01'], 9);
});

test('months outside the period are ignored', () => {
  const r = computeMonthly(lines, [{ category: 'Fuel & Lube Oil', amount: 500, ym: '2025-12' }], [], months);
  assert.equal(r.buckets.find((b) => b.bucket === 'Fuel').lines[0].total, 0);
});

test('monthsInPeriod within a calendar year', () => {
  const m = monthsInPeriod('2026-01-15', '2026-03-10');
  assert.deepEqual(m.map((x) => x.ym), ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(m.map((x) => x.label), ['Jan', 'Feb', 'Mar']);
});

test('monthsInPeriod spanning a year boundary labels the year', () => {
  const m = monthsInPeriod('2026-11-01', '2027-02-01');
  assert.deepEqual(m.map((x) => x.ym), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.equal(m[0].label, 'Nov 26');
  assert.equal(m[3].label, 'Feb 27');
});

// Cargo Accounts — guided-create seed tests. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSeed, priorPeriodOf } from './budgetSeed.js';

const chart = [
  { bucket: 'Running', category: 'Fuel & Lube Oil', code: 'FLE', kind: 'expense' },
  { bucket: 'Guest', category: 'Guest Food & Provisions', code: 'GFE', kind: 'expense' },
  { bucket: 'Revenue', category: 'Net Charter Revenue', code: 'NCR', kind: 'revenue' },
];
const months2027 = [
  { ym: '2027-06', label: 'Jun' }, { ym: '2027-07', label: 'Jul' }, { ym: '2027-08', label: 'Aug' },
];

test('prior spend seeds the matching line, aligned by month-of-year', () => {
  const prior = [
    { category: 'Fuel & Lube Oil', amount: 1000, ym: '2026-06' },
    { category: 'Fuel & Lube Oil', amount: 2000, ym: '2026-07' },
    { category: 'Guest Food & Provisions', amount: 500, ym: '2026-08' },
  ];
  const { lines, seededTotal } = computeSeed(chart, prior, months2027, { uplift: 0 });
  const fuel = lines.find((l) => l.code === 'FLE');
  assert.equal(fuel.amount, 3000);
  assert.equal(fuel.monthly['2027-06'], 1000); // June 2026 -> June 2027
  assert.equal(fuel.monthly['2027-07'], 2000);
  assert.equal(seededTotal, 3500);
});

test('uplift scales every seeded figure', () => {
  const prior = [{ category: 'Fuel & Lube Oil', amount: 1000, ym: '2026-07' }];
  const { lines } = computeSeed(chart, prior, months2027, { uplift: 5 });
  const fuel = lines.find((l) => l.code === 'FLE');
  assert.equal(fuel.amount, 1050);
  assert.equal(fuel.monthly['2027-07'], 1050);
});

test('a target total scales the whole plan to hit it (uplift ignored)', () => {
  const prior = [
    { category: 'Fuel & Lube Oil', amount: 3000, ym: '2026-07' },
    { category: 'Guest Food & Provisions', amount: 1000, ym: '2026-07' },
  ]; // raw total 4000
  const { lines, seededTotal } = computeSeed(chart, prior, months2027, { target: 8000, uplift: 5 });
  assert.equal(seededTotal, 8000);                       // scaled x2, not x1.05
  assert.equal(lines.find((l) => l.code === 'FLE').amount, 6000);
  assert.equal(lines.find((l) => l.code === 'GFE').amount, 2000);
});

test('a per-line uplift overrides the baseline, and flags itself as adjusted', () => {
  const prior = [
    { category: 'Fuel & Lube Oil', amount: 1000, ym: '2026-07' },
    { category: 'Guest Food & Provisions', amount: 1000, ym: '2026-07' },
  ];
  const { lines } = computeSeed(chart, prior, months2027, {
    uplift: 5,
    perLine: { 'fuel & lube oil': { uplift: 12, reason: 'Bunker price forecast' } },
  });
  const fuel = lines.find((l) => l.code === 'FLE');
  const guest = lines.find((l) => l.code === 'GFE');
  assert.equal(fuel.amount, 1120);          // +12%, not the +5% baseline
  assert.equal(fuel.upliftPct, 12);
  assert.equal(fuel.adjusted, true);
  assert.equal(fuel.reason, 'Bunker price forecast');
  assert.equal(guest.amount, 1050);         // still on baseline +5%
  assert.equal(guest.adjusted, false);
  assert.equal(guest.reason, null);
});

test('a negative per-line uplift reduces a line (e.g. no refit this cycle)', () => {
  const prior = [{ category: 'Fuel & Lube Oil', amount: 1000, ym: '2026-07' }];
  const { lines } = computeSeed(chart, prior, months2027, {
    uplift: 5, perLine: { 'fuel & lube oil': { uplift: -20 } },
  });
  assert.equal(lines.find((l) => l.code === 'FLE').amount, 800);
});

test('each seeded line exposes its prior-year figure for display', () => {
  const prior = [{ category: 'Fuel & Lube Oil', amount: 3000, ym: '2026-07' }];
  const { lines } = computeSeed(chart, prior, months2027, { uplift: 10 });
  const fuel = lines.find((l) => l.code === 'FLE');
  assert.equal(fuel.priorAmount, 3000);
  assert.equal(fuel.amount, 3300);
});

test('revenue lines are not seeded from spend', () => {
  const prior = [{ category: 'Net Charter Revenue', amount: 9000, ym: '2026-07' }];
  const { lines } = computeSeed(chart, prior, months2027, { uplift: 0 });
  assert.equal(lines.find((l) => l.code === 'NCR').amount, 0);
});

test('prior spend outside the new period months is dropped from the seed', () => {
  const prior = [
    { category: 'Fuel & Lube Oil', amount: 1000, ym: '2026-07' }, // in period
    { category: 'Fuel & Lube Oil', amount: 5000, ym: '2026-01' }, // Jan not in Jun–Aug
  ];
  const { lines } = computeSeed(chart, prior, months2027, { uplift: 0 });
  assert.equal(lines.find((l) => l.code === 'FLE').amount, 1000);
});

test('empty prior data yields a zeroed chart, not a crash', () => {
  const { lines, seededTotal, seededCount } = computeSeed(chart, [], months2027, { uplift: 5 });
  assert.equal(lines.length, 3);
  assert.equal(seededTotal, 0);
  assert.equal(seededCount, 0);
  assert.deepEqual(lines.find((l) => l.code === 'FLE').monthly, {});
});

test('target with no prior spend cannot fabricate figures (stays zero)', () => {
  const { lines, seededTotal } = computeSeed(chart, [], months2027, { target: 5000 });
  assert.equal(seededTotal, 0);
  assert.equal(lines.every((l) => l.amount === 0), true);
});

test('priorPeriodOf shifts a season back exactly one year', () => {
  assert.deepEqual(priorPeriodOf('2027-01-01', '2027-12-31'), { from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual(priorPeriodOf('2026-11-01', '2027-03-31'), { from: '2025-11-01', to: '2026-03-31' });
});

// Cargo Accounts — "Suggest %" tests. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSuggestions } from './budgetSuggest.js';

const chart = [
  { bucket: 'Fuel', code: 'FLE', category: 'Fuel & Lube Oil', kind: 'expense' },
  { bucket: 'Crew Cost', code: 'OCW', category: 'Officer & Crew Wages', kind: 'expense' },
  { bucket: 'General', code: 'MSC', category: 'Miscellaneous Ship Cost', kind: 'expense' },
  { bucket: 'Revenue', code: 'NCR', category: 'Net Charter Revenue', kind: 'revenue' },
];

test('uses the vessel own YoY trend where two seasons of history exist', () => {
  const yoy = { 'fuel & lube oil': { recent: 111000, prev: 100000, pct: 11 } };
  const s = computeSuggestions(chart, yoy, { recentYear: 2026, prevYear: 2025 });
  assert.equal(s['fuel & lube oil'].uplift, 11);
  assert.equal(s['fuel & lube oil'].basis, 'history');
  assert.match(s['fuel & lube oil'].reason, /2025→2026/);
});

test('falls back to category sensitivity when there is no history', () => {
  const s = computeSuggestions(chart, {}, {});
  assert.equal(s['fuel & lube oil'].uplift, 8);     // fuel default
  assert.equal(s['fuel & lube oil'].basis, 'sensitivity');
  assert.equal(s['officer & crew wages'].uplift, 3); // wages default
  assert.equal(s['miscellaneous ship cost'].uplift, 4); // generic default
});

test('an extreme trend is clamped to a sane planning range', () => {
  const yoy = { 'fuel & lube oil': { recent: 500000, prev: 100000, pct: 400 } };
  const s = computeSuggestions(chart, yoy, { clampHi: 60 });
  assert.equal(s['fuel & lube oil'].uplift, 60);
});

test('a tiny prior line is treated as noise and uses sensitivity, not its % swing', () => {
  const yoy = { 'fuel & lube oil': { recent: 900, prev: 100, pct: 800 } }; // prev < minPrev
  const s = computeSuggestions(chart, yoy, {});
  assert.equal(s['fuel & lube oil'].uplift, 8);      // sensitivity, not 800
  assert.equal(s['fuel & lube oil'].basis, 'sensitivity');
});

test('a line that stopped (recent 0) uses sensitivity rather than −100%', () => {
  const yoy = { 'fuel & lube oil': { recent: 0, prev: 100000, pct: -100 } };
  const s = computeSuggestions(chart, yoy, {});
  assert.equal(s['fuel & lube oil'].basis, 'sensitivity');
});

test('revenue lines are never suggested', () => {
  const s = computeSuggestions(chart, {}, {});
  assert.equal(s['net charter revenue'], undefined);
});

test('every expense line gets a suggestion with a reason', () => {
  const s = computeSuggestions(chart, {}, {});
  const expenseKeys = ['fuel & lube oil', 'officer & crew wages', 'miscellaneous ship cost'];
  expenseKeys.forEach((k) => { assert.ok(s[k].reason && s[k].reason.length > 0); });
});

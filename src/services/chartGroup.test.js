// Cargo Accounts — chart grouping tests. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupChartLines } from './chartGroup.js';

const rows = [
  { id: '1', bucket: 'Revenue', kind: 'revenue', code: 'NCR', category: 'Net Charter Revenue' },
  { id: '2', bucket: 'Revenue', kind: 'revenue', code: 'OIN', category: 'Other Income' },
  { id: '3', bucket: 'Crew Cost', kind: 'expense', code: 'OCW', category: 'Officer & Crew Wages' },
  { id: '4', bucket: 'Crew Cost', kind: 'expense', code: 'CUF', category: 'Crew Uniforms' },
];

test('folds flat rows into buckets, preserving first-seen order', () => {
  const g = groupChartLines(rows);
  assert.equal(g.length, 2);
  assert.equal(g[0].bucket, 'Revenue');
  assert.equal(g[1].bucket, 'Crew Cost');
});

test('carries the bucket kind and all lines', () => {
  const g = groupChartLines(rows);
  assert.equal(g[0].kind, 'revenue');
  assert.equal(g[0].lines.length, 2);
  assert.equal(g[1].lines.length, 2);
  assert.equal(g[1].lines[0].code, 'OCW');
});

test('keeps line order within a bucket', () => {
  const g = groupChartLines(rows);
  assert.deepEqual(g[1].lines.map((l) => l.category), ['Officer & Crew Wages', 'Crew Uniforms']);
});

test('empty / nullish input yields an empty array', () => {
  assert.deepEqual(groupChartLines([]), []);
  assert.deepEqual(groupChartLines(null), []);
  assert.deepEqual(groupChartLines(undefined), []);
});

test('a bucket reappearing later still collapses into one group', () => {
  const g = groupChartLines([
    { bucket: 'A', kind: 'expense', category: 'a1' },
    { bucket: 'B', kind: 'expense', category: 'b1' },
    { bucket: 'A', kind: 'expense', category: 'a2' },
  ]);
  assert.equal(g.length, 2);
  assert.equal(g[0].lines.length, 2);
});

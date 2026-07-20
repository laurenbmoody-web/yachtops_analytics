// Cargo Accounts — vessel overview view-helper tests. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupAccountsByHolder, fundsTotals } from './accountsView.js';

const accounts = [
  { id: '1', holder_role: 'Captain', funds_type: 'owner', kind: 'card', base_balance: 8120, unreconciled: 3, is_active: true },
  { id: '2', holder_role: 'Captain', funds_type: 'charter_apa', kind: 'card', base_balance: 3940, unreconciled: 0, is_active: true },
  { id: '3', holder_role: 'Captain', funds_type: 'general', kind: 'petty_cash', base_balance: 880, unreconciled: 0, is_active: true },
  { id: '4', holder_role: 'Vessel', funds_type: 'general', kind: 'bank', base_balance: 371730, unreconciled: 0, is_active: true },
  { id: '5', holder_role: 'Chief Stewardess', funds_type: 'owner', kind: 'card', base_balance: 1920, unreconciled: 0, is_active: true },
  { id: '6', holder_role: 'Captain', funds_type: 'owner', kind: 'card', base_balance: 999, is_active: false }, // inactive, excluded
];

test('groups by holder with Vessel first', () => {
  const g = groupAccountsByHolder(accounts);
  assert.equal(g[0].holder, 'Vessel');
  assert.deepEqual(g.map((x) => x.holder), ['Vessel', 'Captain', 'Chief Stewardess']);
});

test('group totals sum base balances of active accounts only', () => {
  const g = groupAccountsByHolder(accounts);
  const cap = g.find((x) => x.holder === 'Captain');
  assert.equal(cap.total, 8120 + 3940 + 880); // inactive 999 excluded
  assert.equal(cap.accounts.length, 3);
});

test('group toReconcile counts accounts with unreconciled rows', () => {
  const g = groupAccountsByHolder(accounts);
  assert.equal(g.find((x) => x.holder === 'Captain').toReconcile, 1);
  assert.equal(g.find((x) => x.holder === 'Vessel').toReconcile, 0);
});

test('fundsTotals splits by funds type and petty cash', () => {
  const f = fundsTotals(accounts);
  assert.equal(f.owner, 8120 + 1920);
  assert.equal(f.charterApa, 3940);
  assert.equal(f.pettyCash, 880);
  assert.equal(f.ownerCards, 2);
  assert.equal(f.pettyFloats, 1);
  assert.equal(f.holders, 3);
});

test('empty input is safe', () => {
  assert.deepEqual(groupAccountsByHolder([]), []);
  assert.equal(fundsTotals([]).owner, 0);
});

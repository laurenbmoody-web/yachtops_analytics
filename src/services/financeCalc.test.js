// Cargo Accounts — Phase 0. Balance-math unit tests. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeAccountBalance,
  computeAccountBaseBalance,
  computeCashPosition,
  isNeedsAttention,
  deriveAmountBase,
} from './financeCalc.js';

const acc = (id, extra = {}) => ({ id, opening_balance: 0, is_active: true, ...extra });

test('computeAccountBalance = opening + sum of that account\'s live amounts', () => {
  const a = acc('a', { opening_balance: 100 });
  const txns = [
    { account_id: 'a', amount: 50, status: 'reconciled' },     // +50
    { account_id: 'a', amount: -30, status: 'unreconciled' },  // -30
    { account_id: 'b', amount: -999, status: 'reconciled' },   // other account, ignored
  ];
  assert.equal(computeAccountBalance(a, txns), 120);
});

test('voided transactions never affect a balance', () => {
  const a = acc('a', { opening_balance: 0 });
  const txns = [
    { account_id: 'a', amount: 200, status: 'reconciled' },
    { account_id: 'a', amount: -75, status: 'void' },          // ignored
  ];
  assert.equal(computeAccountBalance(a, txns), 200);
});

test('base balance uses amount_base, not amount', () => {
  const a = acc('a', { opening_balance: 10 });
  const txns = [
    { account_id: 'a', amount: 100, amount_base: 90, status: 'reconciled' },
  ];
  assert.equal(computeAccountBaseBalance(a, txns), 100);   // 10 + 90
});

test('cash position sums active accounts only, in base', () => {
  const accounts = [
    acc('a', { opening_balance: 100 }),
    acc('b', { opening_balance: 50, is_active: false }),     // excluded
  ];
  const txns = [
    { account_id: 'a', amount_base: 25, status: 'reconciled' },
    { account_id: 'b', amount_base: 1000, status: 'reconciled' },
    { account_id: null, amount_base: -500, status: 'unreconciled' }, // unassigned, excluded
  ];
  assert.equal(computeCashPosition(accounts, txns), 125);
});

test('isNeedsAttention flags unassigned or unreconciled rows', () => {
  assert.equal(isNeedsAttention({ account_id: null, status: 'unreconciled' }), true);
  assert.equal(isNeedsAttention({ account_id: 'a', status: 'unreconciled' }), true);
  assert.equal(isNeedsAttention({ account_id: 'a', status: 'reconciled' }), false);
});

test('deriveAmountBase multiplies and rounds to 2dp', () => {
  assert.equal(deriveAmountBase(100, 1), 100);
  assert.equal(deriveAmountBase(100, 0.8642), 86.42);
  assert.equal(deriveAmountBase(-50, 1.1), -55);
});

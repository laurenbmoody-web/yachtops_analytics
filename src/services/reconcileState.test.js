// Cargo Accounts — month-end reconcile-state tests. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodMonthISO, canSubmit, reconcileMessage, closingBalance } from './reconcileState.js';

test('periodMonthISO zero-pads the month', () => {
  assert.equal(periodMonthISO(2025, 5), '2025-05-01');
  assert.equal(periodMonthISO(2025, 12), '2025-12-01');
});

test('canSubmit only when nothing to sort and all matched', () => {
  assert.equal(canSubmit({ toSort: 0, matched: 34, total: 34 }), true);
  assert.equal(canSubmit({ toSort: 2, matched: 34, total: 34 }), false);
  assert.equal(canSubmit({ toSort: 0, matched: 31, total: 34 }), false);
  assert.equal(canSubmit({ toSort: 0, matched: 0, total: 0 }), false);
  assert.equal(canSubmit(null), false);
});

test('reconcileMessage reflects the working state', () => {
  assert.equal(reconcileMessage({ toSort: 3, matched: 31, total: 34 }, 'open').tone, 'due');
  assert.equal(reconcileMessage({ toSort: 0, matched: 31, total: 34 }, 'open').text, 'Sorted — now import your statement');
  assert.equal(reconcileMessage({ toSort: 0, matched: 34, total: 34 }, 'open').tone, 'ok');
  assert.equal(reconcileMessage({ toSort: 0, matched: 34, total: 34 }, 'submitted').tone, 'sent');
  assert.equal(reconcileMessage({}, 'approved').tone, 'ok');
});

test('closingBalance = opening + signed amounts', () => {
  assert.equal(closingBalance(0, [{ amount: 11562.55 }, { amount: -11362.55 }]), 200);
  assert.equal(closingBalance(200, []), 200);
  assert.equal(closingBalance(null, null), 0);
});

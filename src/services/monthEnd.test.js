// Cargo Accounts — month-end close tests. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fundingModel, fundingModelLabel, monthFigures,
  compareFigure, isBalanced, statementChecks, hasEnoughStatement,
  fundingOutcome, closeBlockers, canCloseMonth, closeMessage, closeHeadline,
} from './monthEnd.js';

// ── funding model ───────────────────────────────────────────────────────────
test('the funding model comes from funds_type, and an explicit setting wins', () => {
  assert.equal(fundingModel({ funds_type: 'charter_apa' }), 'apa');
  assert.equal(fundingModel({ funds_type: 'owner' }), 'imprest');
  assert.equal(fundingModel({ funds_type: 'petty_cash' }), 'imprest');
  assert.equal(fundingModel({ funds_type: 'general' }), 'imprest');
  assert.equal(fundingModel({}), 'imprest');
  // Prepaid has no funds_type of its own, so it must be declared.
  assert.equal(fundingModel({ funds_type: 'general', funding_model: 'prepaid' }), 'prepaid');
  assert.match(fundingModelLabel('prepaid'), /Prepaid/);
});

// ── the cash-book equation ──────────────────────────────────────────────────
test('figures split money in and out and carry to a closing balance', () => {
  const f = monthFigures(20000, [
    { amount: -14300, status: 'reconciled' },
    { amount: -200, status: 'unreconciled' },
    { amount: 500, status: 'reconciled' },
  ]);
  assert.equal(f.opening, 20000);
  assert.equal(f.moneyOut, -14500);
  assert.equal(f.moneyIn, 500);
  assert.equal(f.net, -14000);
  assert.equal(f.closing, 6000);
});

test('void lines never move money', () => {
  const f = monthFigures(1000, [
    { amount: -100, status: 'reconciled' },
    { amount: -9999, status: 'void' },
  ]);
  assert.equal(f.moneyOut, -100);
  assert.equal(f.closing, 900);
});

// ── matching the statement ──────────────────────────────────────────────────
test("the statement's monthly total is the figure we must match", () => {
  // The practical check: the statement says £14,500 went out; so must we.
  const f = monthFigures(20000, [{ amount: -14500, status: 'reconciled' }]);
  const ok = statementChecks(f, { moneyOut: 14500 });
  const out = ok.find((c) => c.key === 'moneyOut');
  assert.equal(out.ours, 14500);
  assert.equal(out.theirs, 14500);
  assert.equal(out.ok, true);
  assert.equal(out.difference, 0);
});

test('a missing line shows up as a total-out mismatch', () => {
  // We hold £14,300 of spend; the statement says £14,500 — a £200 line never arrived.
  const f = monthFigures(20000, [{ amount: -14300, status: 'reconciled' }]);
  const checks = statementChecks(f, { moneyOut: 14500 });
  const out = checks.find((c) => c.key === 'moneyOut');
  assert.equal(out.ok, false);
  assert.equal(out.difference, -200);      // we're short by 200
});

test('the statement total is read as a magnitude, however it is entered', () => {
  const f = monthFigures(0, [{ amount: -500, status: 'reconciled' }]);
  assert.equal(statementChecks(f, { moneyOut: 500 }).find((c) => c.key === 'moneyOut').ok, true);
  assert.equal(statementChecks(f, { moneyOut: -500 }).find((c) => c.key === 'moneyOut').ok, true);
});

test('only the figures the statement actually states are checked', () => {
  const f = monthFigures(20000, [{ amount: -14500, status: 'reconciled' }]);
  const checks = statementChecks(f, { moneyOut: 14500 });
  assert.equal(checks.find((c) => c.key === 'closing').stated, false);
  assert.equal(checks.find((c) => c.key === 'closing').ok, null);
  assert.equal(compareFigure(100, null), null);
  assert.equal(compareFigure(100, ''), null);
});

test('a closing balance catches an error carried in from the opening balance', () => {
  // Movements agree, but the opening balance was wrong, so closing disagrees.
  const f = monthFigures(19000, [{ amount: -14500, status: 'reconciled' }]);
  const checks = statementChecks(f, { moneyOut: 14500, closing: 5500 });
  assert.equal(checks.find((c) => c.key === 'moneyOut').ok, true);   // the month is right
  assert.equal(checks.find((c) => c.key === 'closing').ok, false);   // the carry-in isn't
  assert.equal(checks.find((c) => c.key === 'closing').difference, -1000);
});

test('a closing balance alone is enough to reconcile against; nothing at all is not', () => {
  const f = monthFigures(0, []);
  assert.equal(hasEnoughStatement(statementChecks(f, { closing: 0 })), true);
  assert.equal(hasEnoughStatement(statementChecks(f, { moneyOut: 0 })), true);
  assert.equal(hasEnoughStatement(statementChecks(f, {})), false);
  assert.equal(hasEnoughStatement(statementChecks(f, { opening: 100 })), false);  // opening proves nothing on its own
});

test('isBalanced tolerates rounding but not real pennies', () => {
  assert.equal(isBalanced(0), true);
  assert.equal(isBalanced(0.004), true);
  assert.equal(isBalanced(0.01), false);
  assert.equal(isBalanced(null), false);
});

// ── funding outcomes ────────────────────────────────────────────────────────
test('an imprest float asks for the top-up that restores it', () => {
  const f = monthFigures(20000, [{ amount: -14300, status: 'reconciled' }]);
  const o = fundingOutcome('imprest', f, { float_target: 20000 });
  assert.equal(o.key, 'reimbursement');
  assert.equal(o.amount, 14300);           // exactly what was spent
  assert.equal(o.floatTarget, 20000);
});

test('with no float level set, an imprest account still reports the spend to claim', () => {
  const f = monthFigures(0, [{ amount: -14300, status: 'reconciled' }]);
  const o = fundingOutcome('imprest', f, {});
  assert.equal(o.amount, 14300);
  assert.equal(o.floatTarget, null);
  assert.match(o.note, /Set a float level/);
});

test('a prepaid card reports what is left, and warns when exhausted', () => {
  const left = fundingOutcome('prepaid', monthFigures(6000, [{ amount: -300 }]), {});
  assert.equal(left.key, 'available');
  assert.equal(left.amount, 5700);
  const spent = fundingOutcome('prepaid', monthFigures(300, [{ amount: -300 }]), {});
  assert.match(spent.note, /top-up is needed/);
});

test('an APA returns the unspent balance to the guest — and flags an overspend', () => {
  const left = fundingOutcome('apa', monthFigures(10000, [{ amount: -6900 }]), {});
  assert.equal(left.key, 'return');
  assert.equal(left.amount, 3100);
  assert.equal(left.overspent, 0);

  const over = fundingOutcome('apa', monthFigures(10000, [{ amount: -10500 }]), {});
  assert.equal(over.amount, 0);
  assert.equal(over.overspent, 500);       // due FROM the guest
  assert.match(over.note, /due from the guest/);
});

// ── closing the month ───────────────────────────────────────────────────────
const receiptAll = () => true;
const noSplits = () => 0;

test('a month with everything done and totals matching can be closed', () => {
  const txns = [{ amount: -14500, status: 'reconciled', category: 'Deck Consumables', account_id: 'a1' }];
  const figures = monthFigures(20000, txns);
  const args = { txns, figures, statement: { moneyOut: 14500, closing: 5500 }, hasReceipt: receiptAll, splitCount: noSplits };
  assert.deepEqual(closeBlockers(args), []);
  assert.equal(canCloseMonth(args), true);
  assert.equal(closeMessage([], 'open'), 'Balanced — ready to close.');
});

test('a mismatch against the statement blocks the close and says by how much', () => {
  const txns = [{ amount: -14300, status: 'reconciled', category: 'X', account_id: 'a1' }];
  const figures = monthFigures(20000, txns);
  const blockers = closeBlockers({ txns, figures, statement: { moneyOut: 14500 }, hasReceipt: receiptAll, splitCount: noSplits });
  const diff = blockers.find((b) => b.key === 'diff:moneyOut');
  assert.ok(diff, 'should block on the total-out difference');
  assert.equal(diff.amount, 200);
  assert.match(closeMessage(blockers, 'open'), /Out by 200\.00/);
  assert.equal(canCloseMonth({ txns, figures, statement: { moneyOut: 14500 }, hasReceipt: receiptAll, splitCount: noSplits }), false);
});

test('unfinished work blocks the close before any figures are compared', () => {
  const txns = [
    { amount: -100, status: 'unreconciled', account_id: 'a1' },              // no category
    { amount: -50, status: 'unreconciled', category: 'X' },                  // no account
    { amount: -20, status: 'unreconciled', category: 'X', account_id: 'a1', is_pending: true },
  ];
  const figures = monthFigures(0, txns);
  const blockers = closeBlockers({ txns, figures, statement: { moneyOut: 170 }, hasReceipt: () => false, splitCount: noSplits });
  const keys = blockers.map((b) => b.key);
  assert.ok(keys.includes('uncategorised'));
  assert.ok(keys.includes('unassigned'));
  assert.ok(keys.includes('receipts'));
  assert.ok(keys.includes('pending'));
});

test('a split line counts as categorised for the close', () => {
  const txns = [{ amount: -100, status: 'reconciled', account_id: 'a1' }];
  const figures = monthFigures(0, txns);
  const blockers = closeBlockers({
    txns, figures, statement: { moneyOut: 100 },
    hasReceipt: receiptAll, splitCount: () => 2,
  });
  assert.equal(blockers.find((b) => b.key === 'uncategorised'), undefined);
});

test('with no statement figures entered, the close asks for them', () => {
  const txns = [{ amount: -100, status: 'reconciled', category: 'X', account_id: 'a1' }];
  const blockers = closeBlockers({ txns, figures: monthFigures(0, txns), statement: {}, hasReceipt: receiptAll, splitCount: noSplits });
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].key, 'statement');
});

test('receipts can be waived without waiving the money checks', () => {
  const txns = [{ amount: -100, status: 'reconciled', category: 'X', account_id: 'a1' }];
  const figures = monthFigures(0, txns);
  const args = { txns, figures, statement: { moneyOut: 100 }, hasReceipt: () => false, splitCount: noSplits, requireReceipts: false };
  assert.deepEqual(closeBlockers(args), []);
});

test('closeMessage reflects a submitted or approved month', () => {
  assert.match(closeMessage([], 'submitted'), /Submitted/);
  assert.match(closeMessage([], 'approved'), /signed off/);
});

// ── the headline: one instruction, the next one ─────────────────────────────
test('with nothing entered it asks for the statement figures', () => {
  const h = closeHeadline([{ key: 'statement', label: 'enter the month’s figures from the bank statement', count: 0 }], 'open', 'July 2026');
  assert.match(h, /Type July 2026’s figures from the bank statement/);
});

test('a mismatch outranks unfinished lines, and says which way', () => {
  // Categorising more lines cannot fix a total that disagrees, so the mismatch
  // has to be the instruction even when other blockers are queued ahead of it.
  const blockers = [
    { key: 'uncategorised', label: 'still to categorise', count: 97 },
    { key: 'diff:moneyOut', label: 'total out doesn’t match the statement', amount: 40, ours: 10645.47, theirs: 10605.47 },
  ];
  const h = closeHeadline(blockers, 'open', 'July 2026');
  assert.match(h, /40\.00 more than the statement on total out/);
});

test('the headline formats money the way the page does', () => {
  // Bare "100.01" reads as a quantity, not an amount — the currency has to come
  // from the account, so the caller supplies the formatter.
  const h = closeHeadline([
    { key: 'diff:moneyOut', label: 'total out doesn’t match the statement', amount: 100.01, ours: 2, theirs: 1 },
  ], 'open', 'July 2026', (n) => `£${n.toFixed(2)}`);
  assert.match(h, /£100\.01 more than the statement/);
});

test('the other direction reads the other way round', () => {
  const h = closeHeadline([
    { key: 'diff:closing', label: 'closing balance doesn’t match the statement', amount: 12.5, ours: 100, theirs: 112.5 },
  ], 'open', 'July 2026');
  assert.match(h, /12\.50 less than the statement/);
});

test('otherwise it names the first blocker and pluralises honestly', () => {
  assert.match(closeHeadline([{ key: 'receipts', label: 'without a receipt', count: 1 }], 'open'), /^1 line without a receipt — sort it first\.$/);
  assert.match(closeHeadline([{ key: 'receipts', label: 'without a receipt', count: 4 }], 'open'), /^4 lines without a receipt — sort those first\.$/);
});

test('no blockers is an instruction too', () => {
  assert.equal(closeHeadline([], 'open', 'July 2026'), 'Everything agrees. Close July 2026.');
});

test('a closed month stops instructing', () => {
  assert.equal(closeHeadline([], 'submitted', 'July 2026'), 'July 2026 is with Command for sign-off.');
  assert.equal(closeHeadline([], 'approved', 'July 2026'), 'July 2026 is closed and signed off.');
});

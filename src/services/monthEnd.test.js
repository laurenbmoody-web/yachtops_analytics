// Cargo Accounts — month-end close tests. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fundingModel, fundingModelLabel, monthFigures,
  compareFigure, isBalanced, statementChecks, hasEnoughStatement,
  fundingOutcome, closeBlockers, canCloseMonth, closeMessage, closeHeadline,
  monthEndStage, opensByDefault, stageSummary, lastDayOfMonth, closeDrift,
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

// ── when a month is actually due ────────────────────────────────────────────
const JULY_30 = new Date('2026-07-30T09:00:00Z');

test('the month you are living in is still running, not overdue', () => {
  // Nagging someone to reconcile July on 30 July asks them to match a statement
  // the bank has not issued.
  assert.equal(monthEndStage('2026-07', JULY_30), 'running');
});

test('a month that has ended is due', () => {
  assert.equal(monthEndStage('2026-06', JULY_30), 'due');
  assert.equal(monthEndStage('2025-12', JULY_30), 'due');
});

test('a month that has not started is neither', () => {
  assert.equal(monthEndStage('2026-08', JULY_30), 'ahead');
});

test('a submitted or signed-off month is closed whatever the date', () => {
  assert.equal(monthEndStage('2026-06', JULY_30, 'submitted'), 'closed');
  assert.equal(monthEndStage('2026-06', JULY_30, 'approved'), 'closed');
  assert.equal(monthEndStage('2026-06', JULY_30, 'open'), 'due');
});

test('the last second of the month still counts as running', () => {
  assert.equal(monthEndStage('2026-07', new Date('2026-07-31T23:59:59Z')), 'running');
  assert.equal(monthEndStage('2026-07', new Date('2026-08-01T00:00:01Z')), 'due');
});

test('only a month that is over opens itself', () => {
  assert.equal(opensByDefault('due'), true);
  for (const s of ['running', 'ahead', 'closed']) assert.equal(opensByDefault(s), false);
});

test('the statement period ends on the real last day, leap years included', () => {
  assert.equal(lastDayOfMonth('2026-07'), '2026-07-31');
  assert.equal(lastDayOfMonth('2026-06'), '2026-06-30');
  assert.equal(lastDayOfMonth('2026-02'), '2026-02-28');
  assert.equal(lastDayOfMonth('2028-02'), '2028-02-29');
  assert.equal(lastDayOfMonth(''), null);
});

test('the collapsed line is worth reading on its own', () => {
  const blockers = [
    { key: 'uncategorised', label: 'still to categorise', count: 97 },
    { key: 'receipts', label: 'without a receipt', count: 101 },
    { key: 'statement', label: 'enter the figures', count: 0 },
  ];
  const s = stageSummary('running', { monthLabel: 'July 2026', blockers, statementDue: '31/07/2026' });
  assert.match(s, /still running/);
  assert.match(s, /198 lines to sort/);      // counts only real work, not the statement blocker
  assert.match(s, /covers up to 31\/07\/2026/);
});

test('a clean running month says so rather than inventing work', () => {
  assert.match(stageSummary('running', { monthLabel: 'July 2026', blockers: [] }), /every line so far is in order/);
});

test('the other stages each say their own thing', () => {
  assert.match(stageSummary('due', { monthLabel: 'June 2026' }), /over and waiting to be balanced/);
  assert.match(stageSummary('closed', { monthLabel: 'June 2026' }), /is closed/);
  assert.match(stageSummary('ahead', { monthLabel: 'August 2026' }), /hasn’t started/);
});

// ── a closed month that kept moving ─────────────────────────────────────────
const CLOSED = { status: 'submitted', submitted_at: '2026-07-28T10:00:00Z', closing_balance: 1000 };
const line = (id, amount, createdAt) => ({
  id, amount, txn_date: '2026-07-29', created_at: createdAt, status: 'posted',
});

test('an open month has no drift to report', () => {
  assert.equal(closeDrift({ status: 'open' }, [], 0), null);
  assert.equal(closeDrift(null, [], 0), null);
});

test('a closed month that nothing touched is silent', () => {
  const txns = [line('a', -200, '2026-07-10T09:00:00Z')];
  // opening 1200 − 200 = 1000, exactly what was recorded.
  assert.equal(closeDrift(CLOSED, txns, 1200), null);
});

test('lines arriving after the close are counted and priced', () => {
  // Management closed on the 28th; the feed delivered the 29th–31st afterwards.
  const txns = [
    line('a', -200, '2026-07-10T09:00:00Z'),
    line('b', -50, '2026-07-30T09:00:00Z'),
    line('c', -12, '2026-08-01T09:00:00Z'),
  ];
  const d = closeDrift(CLOSED, txns, 1200);
  assert.equal(d.lines, 2);
  assert.equal(d.lineTotal, -62);
  assert.equal(d.recordedClosing, 1000);
  assert.equal(d.closingNow, 938);
  assert.equal(d.movedBy, -62);
});

test('a void line arriving after the close is not drift', () => {
  const txns = [
    line('a', -200, '2026-07-10T09:00:00Z'),
    { ...line('b', -50, '2026-07-30T09:00:00Z'), status: 'void' },
  ];
  assert.equal(closeDrift(CLOSED, txns, 1200), null);
});

test('an edit that moves the balance is caught even with no new lines', () => {
  // Nothing arrived, but a line's amount changed — the recorded closing balance
  // is no longer the ledger's.
  const txns = [line('a', -260, '2026-07-10T09:00:00Z')];
  const d = closeDrift(CLOSED, txns, 1200);
  assert.equal(d.lines, 0);
  assert.equal(d.movedBy, -60);
});

test('an approved month drifts the same as a submitted one', () => {
  const txns = [line('a', -200, '2026-07-10T09:00:00Z'), line('b', -50, '2026-07-30T09:00:00Z')];
  assert.equal(closeDrift({ ...CLOSED, status: 'approved' }, txns, 1200).lines, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findDifferenceCandidates, differenceLead, typoKind, differenceMeaning,
} from './differenceHunt.js';

const t = (id, amount, extra = {}) => ({
  id, amount, txn_date: '2026-07-10', description: `Line ${id}`, status: 'posted', ...extra,
});

// ── Cargo holds more than the statement ─────────────────────────────────────
test('a double-post is named as a double-post, with both lines', () => {
  const rows = [
    t('a', -100.01, { description: 'Cartridge Discount', txn_date: '2026-07-10' }),
    t('b', -100.01, { description: 'Cartridge Discount', txn_date: '2026-07-12' }),
    t('c', -40),
  ];
  const [first] = findDifferenceCandidates({ difference: 100.01, monthTxns: rows });
  assert.equal(first.kind, 'duplicate');
  assert.deepEqual(first.txnIds.sort(), ['a', 'b']);
  assert.match(first.action, /void the copy/);
});

test('same amount but a different merchant is not called a duplicate', () => {
  const rows = [
    t('a', -100.01, { description: 'Cartridge Discount' }),
    t('b', -100.01, { description: 'Ryanair' }),
  ];
  const kinds = findDifferenceCandidates({ difference: 100.01, monthTxns: rows }).map((c) => c.kind);
  assert.equal(kinds.includes('duplicate'), false);
  assert.equal(kinds[0], 'exact');
});

test('a repeat a fortnight later is not a duplicate either', () => {
  const rows = [
    t('a', -100.01, { description: 'Cartridge Discount', txn_date: '2026-07-01' }),
    t('b', -100.01, { description: 'Cartridge Discount', txn_date: '2026-07-25' }),
  ];
  const kinds = findDifferenceCandidates({ difference: 100.01, monthTxns: rows }).map((c) => c.kind);
  assert.equal(kinds.includes('duplicate'), false);
});

test('a pending line explains a gap the bank simply hasn’t posted', () => {
  const rows = [t('a', -73, { is_pending: true }), t('b', -40)];
  const [first] = findDifferenceCandidates({ difference: 73, monthTxns: rows });
  assert.equal(first.kind, 'pending');
  assert.match(first.action, /next month’s statement/);
});

test('a line spent and posted in different months is offered as a straddle', () => {
  const rows = [t('a', -50, { txn_date: '2026-07-31', statement_date: '2026-08-02' })];
  const [first] = findDifferenceCandidates({ difference: 50, monthTxns: rows });
  assert.equal(first.kind, 'straddle');
  assert.match(first.action, /Month by/);
});

test('a refund booked as spend is out by double, and that is said plainly', () => {
  const rows = [t('a', 60), t('b', -12)];
  const kinds = findDifferenceCandidates({ difference: 120, monthTxns: rows });
  assert.equal(kinds[0].kind, 'sign');
  assert.match(kinds[0].action, /double its value/);
});

test('a void line never explains anything', () => {
  const rows = [t('a', -100.01, { status: 'void' })];
  assert.deepEqual(findDifferenceCandidates({ difference: 100.01, monthTxns: rows }), []);
});

// ── the bank holds more than Cargo ──────────────────────────────────────────
test('an unassigned line of exactly the difference is the first thing offered', () => {
  const pool = [t('x', -100.01, { account_id: null })];
  const [first] = findDifferenceCandidates({
    difference: -100.01, monthTxns: [], poolTxns: pool, accountId: 'acct', monthKey: '2026-07',
  });
  assert.equal(first.kind, 'unassigned');
  assert.match(first.action, /assign it and the month agrees/);
});

test('spend on this card dated into another month is offered too', () => {
  const pool = [t('x', -100.01, { account_id: 'acct', txn_date: '2026-08-02' })];
  const [first] = findDifferenceCandidates({
    difference: -100.01, monthTxns: [], poolTxns: pool, accountId: 'acct', monthKey: '2026-07',
  });
  assert.equal(first.kind, 'othermonth');
});

test('another card’s line is not offered — it is not this statement’s money', () => {
  const pool = [t('x', -100.01, { account_id: 'other', txn_date: '2026-08-02' })];
  assert.deepEqual(findDifferenceCandidates({
    difference: -100.01, monthTxns: [], poolTxns: pool, accountId: 'acct', monthKey: '2026-07',
  }), []);
});

// ── discipline ──────────────────────────────────────────────────────────────
test('a balanced month is not offered explanations for a gap it does not have', () => {
  assert.deepEqual(findDifferenceCandidates({ difference: 0, monthTxns: [t('a', -40)] }), []);
  assert.deepEqual(findDifferenceCandidates({ difference: 0.004, monthTxns: [t('a', -40)] }), []);
});

test('one line is blamed once, not under four headings', () => {
  // A pending straddle that is also exactly the difference would otherwise appear
  // three times and read as three separate problems.
  const rows = [t('a', -50, { is_pending: true, statement_date: '2026-08-02' })];
  const found = findDifferenceCandidates({ difference: 50, monthTxns: rows });
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'pending');
});

test('the pair fallback only runs when nothing specific fits', () => {
  const rows = [t('a', -30), t('b', -70)];
  const found = findDifferenceCandidates({ difference: 100, monthTxns: rows });
  assert.equal(found[0].kind, 'pair');
  assert.deepEqual(found[0].txnIds.sort(), ['a', 'b']);

  // With an exact match present, the coincidence is not offered.
  const withExact = findDifferenceCandidates({ difference: 100, monthTxns: [...rows, t('c', -100)] });
  assert.equal(withExact.some((c) => c.kind === 'pair'), false);
});

test('never more than four suggestions', () => {
  const rows = Array.from({ length: 9 }, (_, i) => t(`n${i}`, -25));
  assert.ok(findDifferenceCandidates({ difference: 25, monthTxns: rows }).length <= 4);
});

// ── the lead sentence ───────────────────────────────────────────────────────
test('the lead counts what was found', () => {
  assert.equal(differenceLead([{}]), 'One line would explain it:');
  assert.equal(differenceLead([{}, {}]), '2 lines could explain it:');
});

// ── which number is bigger is NOT what the gap means ────────────────────────
test('on total out, Cargo higher means Cargo holds a charge the bank never made', () => {
  assert.equal(differenceMeaning('moneyOut', 12935.90, 12923.90), 'extraOut');
  assert.equal(differenceMeaning('moneyOut', 12923.90, 12935.90), 'missingOut');
});

test('on the closing balance it is the other way round', () => {
  // More money left means LESS spend recorded. Read off ours > theirs alone,
  // this case got exactly the wrong advice.
  assert.equal(differenceMeaning('closing', 9167, 9155), 'missingOut');
  assert.equal(differenceMeaning('closing', 9155, 9167), 'extraOut');
});

test('the two views of one discrepancy agree with each other', () => {
  // £12 more out and £12 less left are the same event; they must not send the
  // crew looking for two different things.
  const outLead = differenceLead([], { key: 'moneyOut', ours: 12923.90, theirs: 12935.90, amountText: '£12.00' });
  const closeLead = differenceLead([], { key: 'closing', ours: 9167, theirs: 9155, amountText: '£12.00' });
  assert.equal(outLead, closeLead);
  assert.match(outLead, /missing £12\.00 of spending/);
});

test('money in has its own pair of causes', () => {
  // Deliberately not a near-miss like 500 vs 400 — that IS one digit out, and the
  // typo check rightly speaks first.
  assert.equal(differenceMeaning('moneyIn', 500, 380), 'extraIn');
  assert.match(differenceLead([], { key: 'moneyIn', ours: 500, theirs: 380, amountText: '£120.00' }),
    /payment that never actually arrived/);
  assert.match(differenceLead([], { key: 'moneyIn', ours: 380, theirs: 500, amountText: '£120.00' }),
    /never recorded/);
});

test('an opening balance out is last month’s problem, and says so', () => {
  assert.equal(differenceMeaning('opening', 100, 90), 'opening');
  assert.match(differenceLead([], { key: 'opening', ours: 100, theirs: 90, amountText: '£10.00' }),
    /last month’s closing balance/);
});

test('finding nothing leads with what the gap means, then the two jobs', () => {
  const more = differenceLead([], { key: 'moneyOut', ours: 100, theirs: 98, amountText: '£2.00' });
  assert.match(more, /^Cargo has £2\.00 of spending the statement doesn’t\./);
  assert.match(more, /the bank never charged/);
  assert.match(more, /re-check the figure you typed/);

  const less = differenceLead([], { key: 'moneyOut', ours: 98, theirs: 100, amountText: '£2.00' });
  assert.match(less, /^Cargo is missing £2\.00 of spending/);
  assert.match(less, /never made it in/);
  assert.match(less, /re-check the figure you typed/);
});

// ── a mistype is not a missing transaction ──────────────────────────────────
test('one digit out reads as a mistype', () => {
  // 12,923.90 typed as 12,921.90 — the £2.00 gap is a slip of the pen, and
  // sending someone to look for a missing line wastes the afternoon.
  assert.equal(typoKind(12923.90, 12921.90), 'one digit out');
});

test('a swapped pair reads as a mistype', () => {
  assert.equal(typoKind(12923.90, 12932.90), 'two digits swapped');
});

test('a decimal place adrift is caught either way round', () => {
  assert.equal(typoKind(129.23, 1292.30), 'a decimal place out');
  assert.equal(typoKind(1292.30, 129.23), 'a decimal place out');
});

test('an extra digit is caught', () => {
  assert.equal(typoKind(923.90, 9231.90), 'a digit too many');
});

test('a genuinely different figure is not a mistype', () => {
  assert.equal(typoKind(12923.90, 11500.00), null);
  assert.equal(typoKind(100, 100), null);
  assert.equal(typoKind(100, NaN), null);
});

test('the lead checks the typing before sending anyone hunting', () => {
  const lead = differenceLead([], { ours: 12923.90, theirs: 12921.90 });
  assert.match(lead, /one digit out/);
  assert.match(lead, /the one you typed/);
});

test('with no amount given it still reads as a sentence', () => {
  assert.match(differenceLead([], { ours: 12923.90, theirs: 11500 }), /the difference of spending/);
});

test('a matching line still wins over any of it', () => {
  assert.equal(differenceLead([{ key: 'a' }], { ours: 1, theirs: 2 }), 'One line would explain it:');
});

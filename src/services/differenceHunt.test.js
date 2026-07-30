import test from 'node:test';
import assert from 'node:assert/strict';
import { findDifferenceCandidates, differenceLead } from './differenceHunt.js';

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

test('finding nothing says so rather than pretending', () => {
  assert.match(differenceLead([], true), /Nothing in this month matches/);
  assert.match(differenceLead([], false), /bank has spend Cargo doesn’t/);
});

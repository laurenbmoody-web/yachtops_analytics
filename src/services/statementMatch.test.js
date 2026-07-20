// Cargo Accounts — statement matcher tests. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchStatement } from './statementMatch.js';

const txns = [
  { id: 'a', amount: -320.00, txn_date: '2026-06-10', description: 'Fuel dock Palma' },
  { id: 'b', amount: -50.00, txn_date: '2026-06-12', description: 'Courier' },
  { id: 'c', amount: 1000.00, txn_date: '2026-06-15', description: 'Owner funds' },
];

test('equal amount within the date window is a clean match', () => {
  const r = matchStatement([{ id: 'L1', amount: -320.00, line_date: '2026-06-11', description: 'FUEL PALMA' }], txns);
  assert.equal(r.lines[0].match_status, 'matched');
  assert.equal(r.lines[0].matched_txn_id, 'a');
});

test('a statement line with no ledger row is missing (nobody logged it)', () => {
  const r = matchStatement([{ id: 'L1', amount: -75.00, line_date: '2026-06-11', description: 'Chandlery' }], txns);
  assert.equal(r.lines[0].match_status, 'missing');
  assert.equal(r.lines[0].matched_txn_id, null);
});

test('a near amount (fee/rounding) is flagged for review with the candidate', () => {
  const r = matchStatement([{ id: 'L1', amount: -322.50, line_date: '2026-06-10', description: 'Fuel' }], txns);
  assert.equal(r.lines[0].match_status, 'review');
  assert.deepEqual(r.lines[0].candidates, ['a']);
});

test('an exact amount outside the window is not matched (falls to missing)', () => {
  const r = matchStatement([{ id: 'L1', amount: -320.00, line_date: '2026-07-01', description: 'Fuel' }], txns);
  assert.equal(r.lines[0].match_status, 'missing');
});

test('two equal-amount candidates go to review, best-ranked first', () => {
  const dup = [
    { id: 'x', amount: -100, txn_date: '2026-06-10', description: 'Taxi airport' },
    { id: 'y', amount: -100, txn_date: '2026-06-10', description: 'Groceries market' },
  ];
  const r = matchStatement([{ id: 'L1', amount: -100, line_date: '2026-06-10', description: 'AIRPORT TAXI' }], dup);
  assert.equal(r.lines[0].match_status, 'review');
  assert.equal(r.lines[0].candidates[0], 'x'); // description similarity wins the ranking
  assert.equal(r.lines[0].candidates.length, 2);
});

test('each ledger row is consumed once — a second identical line cannot re-match it', () => {
  const two = [
    { id: 'L1', amount: -50.00, line_date: '2026-06-12', description: 'Courier' },
    { id: 'L2', amount: -50.00, line_date: '2026-06-12', description: 'Courier again' },
  ];
  const r = matchStatement(two, txns);
  assert.equal(r.lines[0].match_status, 'matched');
  assert.equal(r.lines[0].matched_txn_id, 'b');
  assert.equal(r.lines[1].match_status, 'missing'); // b already used
});

test('a ledger row in the statement span with no line is unconfirmed', () => {
  // Two lines widen the span to cover the whole period (06-10 … 06-16 ±window),
  // so both the courier (b) and owner funds (c) rows fall inside it.
  const r = matchStatement([
    { id: 'L1', amount: -320.00, line_date: '2026-06-10', description: 'Fuel' },
    { id: 'L2', amount: -12.00, line_date: '2026-06-16', description: 'Parking' },
  ], txns);
  assert.ok(r.unconfirmed.includes('b'));
  assert.ok(r.unconfirmed.includes('c'));
  assert.equal(r.counts.unconfirmed, 2);
});

test('counts summarise the outcome', () => {
  const r = matchStatement([
    { id: 'L1', amount: -320.00, line_date: '2026-06-10', description: 'Fuel' },
    { id: 'L2', amount: -999.00, line_date: '2026-06-10', description: 'Mystery' },
  ], txns);
  assert.equal(r.counts.matched, 1);
  assert.equal(r.counts.missing, 1);
});

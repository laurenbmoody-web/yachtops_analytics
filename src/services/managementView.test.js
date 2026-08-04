import test from 'node:test';
import assert from 'node:assert/strict';
import {
  monthKeyOf, closesMap, naturalMonthOf, linesForPeriod, accountMonth,
  reconciliationState, canSignOff, canQuery, sortFleet, fleetHeadline,
} from './managementView.js';

test('a period_month date reduces to a month key', () => {
  assert.equal(monthKeyOf('2026-07-01'), '2026-07');
  assert.equal(monthKeyOf(''), '');
  assert.equal(monthKeyOf(null), '');
});

test('closes become the map reconcilePeriod expects', () => {
  assert.deepEqual(
    closesMap([
      { period_month: '2026-07-01', submitted_at: '2026-07-28T10:00:00Z' },
      { period_month: '2026-06-01', submitted_at: null },
    ]),
    { '2026-07': '2026-07-28T10:00:00Z' },
  );
});

test('a line belongs to its statement month where it has one', () => {
  assert.equal(naturalMonthOf({ txn_date: '2026-07-30', statement_date: '2026-08-02' }), '2026-08');
  assert.equal(naturalMonthOf({ txn_date: '2026-07-30' }), '2026-07');
});

test('a line entered after its month closed is shown in the next month, not its own', () => {
  const closes = { '2026-07': '2026-07-28T10:00:00Z' };
  const late = { id: 'a', txn_date: '2026-07-20', created_at: '2026-07-30T09:00:00Z' };
  const intime = { id: 'b', txn_date: '2026-07-20', created_at: '2026-07-25T09:00:00Z' };
  const lines = [late, intime];

  assert.deepEqual(linesForPeriod(lines, '2026-07-01', closes).map((l) => l.id), ['b']);
  assert.deepEqual(linesForPeriod(lines, '2026-08-01', closes).map((l) => l.id), ['a']);
});

test('with no period asked for there is nothing to show', () => {
  assert.deepEqual(linesForPeriod([{ id: 'a', txn_date: '2026-07-01' }], null), []);
});

const acct = { id: 'acc1', name: 'Deck card' };
const line = (over) => ({
  account_id: 'acc1', txn_date: '2026-07-04', category_code: '5000',
  has_receipt: true, amount: -100, ...over,
});

test('an account month counts what would make the office query it', () => {
  const got = accountMonth(acct, [
    line({ id: '1' }),
    line({ id: '2', category_code: null, category: null }),
    line({ id: '3', has_receipt: false }),
    line({ id: '4', amount: 250 }),
    { account_id: 'other', amount: -999 },
  ]);
  assert.equal(got.count, 4);
  assert.equal(got.moneyIn, 250);
  assert.equal(got.moneyOut, -300);
  assert.equal(got.net, -50);
  assert.equal(got.uncoded, 1);
  assert.equal(got.unevidenced, 1);
});

test('a statement figure that disagrees with the ledger is named', () => {
  const got = accountMonth(acct, [line({ amount: -100 })], {
    status: 'submitted', stmt_money_out: 120, stmt_money_in: 0, stmt_closing: 500, closing_balance: 500,
  });
  assert.deepEqual(got.mismatches.map((m) => m.label), ['Total out']);
  assert.equal(got.mismatches[0].gap, -20);
});

test('a figure the vessel left blank is not a mismatch', () => {
  const got = accountMonth(acct, [line({ amount: -100 })], {
    status: 'submitted', stmt_money_out: null, stmt_money_in: '', stmt_closing: null, closing_balance: 500,
  });
  assert.deepEqual(got.mismatches, []);
});

test('a queried month reads differently from one the vessel has not finished', () => {
  assert.equal(reconciliationState(null), 'not started');
  assert.equal(reconciliationState({ status: 'open' }), 'with the vessel');
  assert.equal(reconciliationState({ status: 'open', queried_at: '2026-08-01T00:00:00Z' }), 'queried');
  assert.equal(reconciliationState({ status: 'submitted' }), 'awaiting sign-off');
  assert.equal(reconciliationState({ status: 'approved' }), 'signed off');
});

test('the office can only sign off a month the vessel closed', () => {
  assert.equal(canSignOff({ status: 'submitted' }), true);
  assert.equal(canSignOff({ status: 'open' }), false);
  assert.equal(canSignOff({ status: 'approved' }), false);
  assert.equal(canSignOff(null), false);
});

test('a query is available on a closed month and on one already signed off', () => {
  assert.equal(canQuery({ status: 'submitted' }), true);
  assert.equal(canQuery({ status: 'approved' }), true);
  assert.equal(canQuery({ status: 'open' }), false);
});

test('the fleet sorts by who needs the office today', () => {
  const fleet = [
    { vessel_name: 'Zephyr', awaiting_signoff: 0, queried: 0 },
    { vessel_name: 'Aurora', awaiting_signoff: 0, queried: 2 },
    { vessel_name: 'Meridian', awaiting_signoff: 1, queried: 0 },
    { vessel_name: 'Bluebird', awaiting_signoff: 3, queried: 0 },
  ];
  assert.deepEqual(sortFleet(fleet).map((v) => v.vessel_name),
    ['Bluebird', 'Meridian', 'Aurora', 'Zephyr']);
});

test('the headline says what is waiting, or that nothing is', () => {
  assert.equal(fleetHeadline([]), 'No vessels on your books yet.');
  assert.equal(fleetHeadline([{ vessel_name: 'A', awaiting_signoff: 0 }]), 'Nothing waiting on you.');
  assert.equal(
    fleetHeadline([{ awaiting_signoff: 1 }, { awaiting_signoff: 2 }, { awaiting_signoff: 0 }]),
    '3 months waiting on you across 2 vessels.',
  );
  assert.equal(fleetHeadline([{ awaiting_signoff: 1 }]), '1 month waiting on you across 1 vessel.');
});

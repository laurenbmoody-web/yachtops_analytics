// Cargo Accounts — Check-off queue helper tests. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneFor, buildCheckoffRows, groupByLane, checkoffCounts } from './checkoffState.js';

test('laneFor maps status to lane', () => {
  assert.equal(laneFor('submitted'), 'waiting');
  assert.equal(laneFor('approved'), 'done');
  assert.equal(laneFor('open'), 'progress');
  assert.equal(laneFor(null), 'notStarted');
  assert.equal(laneFor(undefined), 'notStarted');
});

const ACCOUNTS = [
  { id: 'a1', name: 'Captain Owner', holder_role: 'Captain', kind: 'card' },
  { id: 'a2', name: 'Chef Float', holder_role: 'Chef', kind: 'petty_cash' },
  { id: 'a3', name: 'Bosun APA', holder_role: 'Bosun', kind: 'card' },
  { id: 'a4', name: 'Old card', holder_role: 'Ex', kind: 'card', is_active: false },
  { id: 'a5', name: 'Vessel bank', holder_role: 'Vessel', kind: 'bank' },
];
const RECONS = [
  { account_id: 'a1', status: 'submitted' },
  { account_id: 'a2', status: 'approved' },
  { account_id: 'a3', status: 'open' },
];

test('buildCheckoffRows joins recon, drops inactive + bank accounts', () => {
  const rows = buildCheckoffRows(ACCOUNTS, RECONS);
  assert.equal(rows.length, 3); // a4 inactive, a5 bank excluded
  assert.deepEqual(rows.map((r) => r.lane), ['waiting', 'done', 'progress']);
  assert.equal(rows.find((r) => r.account.id === 'a1').recon.status, 'submitted');
});

test('groupByLane orders lanes and drops empties', () => {
  const rows = buildCheckoffRows(ACCOUNTS, RECONS);
  const lanes = groupByLane(rows);
  // a3 is 'open' → progress lane present; no 'notStarted' rows here since a3 has a row.
  assert.deepEqual(lanes.map((l) => l.key), ['waiting', 'progress', 'done']);
});

test('checkoffCounts tallies each lane', () => {
  const rows = buildCheckoffRows(ACCOUNTS, RECONS);
  const c = checkoffCounts(rows);
  assert.equal(c.total, 3);
  assert.equal(c.waiting, 1);
  assert.equal(c.progress, 1);
  assert.equal(c.done, 1);
  assert.equal(c.notStarted, 0);
});

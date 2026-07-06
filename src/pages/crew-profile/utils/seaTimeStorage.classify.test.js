// Classification rule: the vessel's own status is the first source of truth, so
// a watch only counts as qualifying WATCHKEEPING when the vessel is UNDERWAY.
// A watch in the yard is yard service; a watch in port / at anchor is standby.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyServiceType, VESSEL_STATUS, SEA_SERVICE_TYPE } from './seaTimeStorage.js';

const cfg = { thresholds: { watchkeepingMinHours: 4 } };
const day = (vesselStatus, watchHours) => classifyServiceType({ vesselStatus, watchHours }, cfg);

test('underway + a ≥4h watch → watchkeeping', () => {
  assert.equal(day(VESSEL_STATUS.UNDERWAY, 6), SEA_SERVICE_TYPE.WATCHKEEPING);
});

test('underway with no qualifying watch → seagoing', () => {
  assert.equal(day(VESSEL_STATUS.UNDERWAY, 0), SEA_SERVICE_TYPE.SEAGOING);
  assert.equal(day(VESSEL_STATUS.UNDERWAY, 3), SEA_SERVICE_TYPE.SEAGOING);
});

test('a watch stood IN THE YARD stays yard service — not watchkeeping', () => {
  assert.equal(day(VESSEL_STATUS.IN_YARD, 8), SEA_SERVICE_TYPE.YARD);
});

test('a watch stood IN PORT / AT ANCHOR is standby — not watchkeeping', () => {
  assert.equal(day(VESSEL_STATUS.IN_PORT, 8), SEA_SERVICE_TYPE.STANDBY);
  assert.equal(day(VESSEL_STATUS.ANCHOR, 8), SEA_SERVICE_TYPE.STANDBY);
});

test('no watch: port/anchor → standby, yard → yard, underway → seagoing', () => {
  assert.equal(day(VESSEL_STATUS.IN_PORT, 0), SEA_SERVICE_TYPE.STANDBY);
  assert.equal(day(VESSEL_STATUS.IN_YARD, 0), SEA_SERVICE_TYPE.YARD);
  assert.equal(day(VESSEL_STATUS.UNDERWAY, 0), SEA_SERVICE_TYPE.SEAGOING);
});

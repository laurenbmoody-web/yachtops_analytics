// Rest-engine basis tests — run with `node --test`. No framework/deps: restHours
// is pure, so the built-in Node test runner imports it directly.
//
// Locks in the operational vs calendar day-basis behaviour (see RotaWorkspace /
// vessels.hor_day_basis): the operational anchor must clear midnight-split
// PHANTOM breaches without hiding GENUINE ones.

import test from 'node:test';
import assert from 'node:assert/strict';
import { reframeToOperationalDay, restForDay } from './restHours.js';

const duty = (date, startTime, endTime) => ({ memberId: 'm', date, shiftType: 'duty', startTime, endTime });
const rest24 = (shifts, date) => restForDay(shifts.filter((s) => s.date === date)).rest24h;
const restByDay = (shifts) => {
  const out = {};
  for (const d of new Set(shifts.map((s) => s.date))) out[d] = rest24(shifts, d);
  return out;
};
const minRest = (shifts) => Math.min(...Object.values(restByDay(shifts)));

// Vessel with an 06:00 operational day. A 02:00–05:00 early callout on 10 Jun is
// really the tail of the 9 Jun working day; the rest of the days are normal.
const phantom = [
  duty('2026-06-09', '08:00', '18:00'),
  duty('2026-06-10', '02:00', '05:00'),
  duty('2026-06-10', '08:00', '20:00'),
  duty('2026-06-11', '08:00', '18:00'),
];

test('calendar basis flags a phantom <10h breach from the midnight split', () => {
  // Midnight lumps the 02:00 callout with the full 10 Jun day → 15h on-duty.
  assert.equal(rest24(phantom, '2026-06-10'), 9);
  assert.ok(rest24(phantom, '2026-06-10') < 10);
});

test('operational day-start (06:00) clears the phantom breach', () => {
  const framed = reframeToOperationalDay(phantom, 6);
  for (const [d, rest] of Object.entries(restByDay(framed))) {
    assert.ok(rest >= 10, `${d} should be compliant, got ${rest}h`);
  }
});

// ~15h on-duty every day — genuine overwork, must breach under ANY basis.
const genuine = [
  duty('2026-06-09', '13:00', '23:00'),
  duty('2026-06-10', '01:00', '06:00'),
  duty('2026-06-10', '13:00', '23:00'),
  duty('2026-06-11', '01:00', '06:00'),
];

test('operational basis does not hide a genuine breach', () => {
  assert.ok(minRest(genuine) < 10, 'calendar should breach');
  assert.ok(minRest(reframeToOperationalDay(genuine, 12)) < 10, 'operational should still breach');
});

test('calendar basis (dayStartHour 0) is a no-op', () => {
  assert.deepEqual(reframeToOperationalDay(phantom, 0), phantom);
});

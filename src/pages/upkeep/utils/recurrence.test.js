// Upkeep recurrence maths. Run: `node --test`.
//
// Date arithmetic is where a maintenance scheduler quietly goes wrong — month
// ends, timezone drift and per-step cadence are all easy to get subtly off, and
// a schedule that fires on the wrong day is worse than one that does not fire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextCalendarDate, describeCalendarRule, describeRecurrence,
  stepAppliesOn, stepsForOccurrence, nextDue, dueState, isOutOfRange, toISODate,
} from './recurrence.js';

// ── toISODate: local, never UTC ─────────────────────────────────────────────
test('toISODate uses local date parts, so a late-evening date does not slip a day', () => {
  // 23:30 local on the 15th is still the 15th, whatever toISOString() would say
  assert.equal(toISODate(new Date(2026, 7, 15, 23, 30)), '2026-08-15');
  assert.equal(toISODate(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
});

// ── calendar rules ──────────────────────────────────────────────────────────
test('daily fires the next day', () => {
  assert.equal(toISODate(nextCalendarDate({ kind: 'daily' }, new Date(2026, 7, 30))), '2026-08-31');
});

test('weekly picks the next listed weekday, and wraps into the following week', () => {
  // Sun 30 Aug 2026 → next Tuesday is 1 Sep
  const tue = nextCalendarDate({ kind: 'weekly', days: ['tuesday'] }, new Date(2026, 7, 30));
  assert.equal(toISODate(tue), '2026-09-01');

  // from a Tuesday, 'tuesday' must go a full week forward, not return today
  const nextTue = nextCalendarDate({ kind: 'weekly', days: ['tuesday'] }, new Date(2026, 8, 1));
  assert.equal(toISODate(nextTue), '2026-09-08');
});

test('weekly with several days takes the nearest one', () => {
  // Sun 30 Aug → Monday beats Friday
  const d = nextCalendarDate({ kind: 'weekly', days: ['friday', 'monday'] }, new Date(2026, 7, 30));
  assert.equal(toISODate(d), '2026-08-31');
});

test('monthly rolls into next month once the day has passed', () => {
  assert.equal(toISODate(nextCalendarDate({ kind: 'monthly', day: 1 }, new Date(2026, 7, 30))), '2026-09-01');
  assert.equal(toISODate(nextCalendarDate({ kind: 'monthly', day: 15 }, new Date(2026, 7, 3))), '2026-08-15');
});

test('monthly clamps to the end of a short month', () => {
  // day 31 in February must land on the 28th, not leak into March
  const d = nextCalendarDate({ kind: 'monthly', day: 31 }, new Date(2026, 1, 1));
  assert.equal(toISODate(d), '2026-02-28');
});

test('interval months clamp rather than overflow', () => {
  // 31 Jan + 1 month = 28 Feb (2026 is not a leap year), never 3 March
  const d = nextCalendarDate({ kind: 'interval', months: 1 }, new Date(2026, 0, 31));
  assert.equal(toISODate(d), '2026-02-28');
});

test('a six-month interval lands on the same day half a year out', () => {
  assert.equal(toISODate(nextCalendarDate({ kind: 'interval', months: 6 }, new Date(2026, 1, 10))), '2026-08-10');
});

// ── labels ──────────────────────────────────────────────────────────────────
test('rules describe themselves in plain English', () => {
  assert.equal(describeCalendarRule({ kind: 'daily' }), 'Every day');
  assert.equal(describeCalendarRule({ kind: 'monthly', day: 1 }), 'Monthly on day 1');
  assert.equal(describeCalendarRule({ kind: 'interval', months: 6 }), 'Every 6 months');
  assert.equal(describeCalendarRule({ kind: 'weekly', days: ['tuesday', 'monday'] }), 'Weekly — Mon, Tue');
});

test("'either' spells out whichever-comes-first", () => {
  const label = describeRecurrence(
    { triggerType: 'either', calendarRule: { kind: 'interval', months: 6 }, counterId: 'c1', counterInterval: 250 },
    { unit: 'h' },
  );
  assert.equal(label, 'Every 250 h or every 6 months — whichever first');
});

// ── per-step cadence (the Interior duty-set pattern) ────────────────────────
test('a step with no frequency belongs on every occurrence', () => {
  assert.equal(stepAppliesOn(null, new Date(2026, 7, 30)), true);
  assert.equal(stepAppliesOn('daily', new Date(2026, 7, 30)), true);
});

test('a weekly-tuesday step only appears on a Tuesday', () => {
  assert.equal(stepAppliesOn('weekly-tuesday', new Date(2026, 8, 1)), true);   // Tue
  assert.equal(stepAppliesOn('weekly-tuesday', new Date(2026, 8, 2)), false);  // Wed
});

test('a monthly-N step only appears on the Nth', () => {
  assert.equal(stepAppliesOn('monthly-1', new Date(2026, 8, 1)), true);
  assert.equal(stepAppliesOn('monthly-1', new Date(2026, 8, 2)), false);
});

test('an unrecognised frequency includes the step rather than silently dropping it', () => {
  // losing a maintenance step to a typo is far worse than showing a spare one
  assert.equal(stepAppliesOn('fortnightly-ish', new Date(2026, 7, 30)), true);
});

test('stepsForOccurrence filters by day and returns them in position order', () => {
  const steps = [
    { position: 2, text: 'c', frequency: 'weekly-tuesday' },
    { position: 0, text: 'a', frequency: null },
    { position: 1, text: 'b', frequency: 'weekly-wednesday' },
  ];
  const tuesday = new Date(2026, 8, 1);
  const got = stepsForOccurrence(steps, tuesday).map((s) => s.text);
  assert.deepEqual(got, ['a', 'c']);
});

// ── due calculation ─────────────────────────────────────────────────────────
test('a counter past its interval is due now, even on an "either" schedule', () => {
  const schedule = {
    triggerType: 'either',
    calendarRule: { kind: 'interval', months: 6 },
    counterInterval: 250,
    lastCompletedCounter: 1000,
  };
  const due = nextDue(schedule, { currentValue: 1260 }, new Date(2026, 7, 30));
  assert.equal(due.basis, 'counter');
  assert.equal(due.counterDue, 1250);
  assert.equal(due.date, '2026-08-30');
});

test('a counter short of its interval leaves the calendar in charge', () => {
  const schedule = {
    triggerType: 'either',
    calendarRule: { kind: 'interval', months: 6 },
    counterInterval: 250,
    lastCompletedCounter: 1000,
  };
  const due = nextDue(schedule, { currentValue: 1100 }, new Date(2026, 7, 30));
  assert.equal(due.basis, 'calendar');
  assert.equal(due.counterDue, 1250);
});

test('a calendar-only schedule ignores counters entirely', () => {
  const due = nextDue(
    { triggerType: 'calendar', calendarRule: { kind: 'daily' }, counterInterval: 250 },
    { currentValue: 99999 },
    new Date(2026, 7, 30),
  );
  assert.equal(due.basis, 'calendar');
  assert.equal(due.counterDue, null);
});

// ── due-state labels ────────────────────────────────────────────────────────
test('dueState separates overdue, today and ahead', () => {
  const today = new Date(2026, 7, 30);
  assert.equal(dueState('2026-08-28', 0, today).key, 'overdue');
  assert.equal(dueState('2026-08-30', 0, today).key, 'today');
  assert.equal(dueState('2026-09-30', 0, today).key, 'ahead');
});

test('dueState counts overdue days and reads naturally at one day', () => {
  const today = new Date(2026, 7, 30);
  assert.equal(dueState('2026-08-29', 0, today).label, '1 day over');
  assert.equal(dueState('2026-08-25', 0, today).label, '5 days over');
});

// ── reading ranges ──────────────────────────────────────────────────────────
test('a reading outside its normal range is flagged, inside is not', () => {
  assert.equal(isOutOfRange(7, -2, 5), true);
  assert.equal(isOutOfRange(-4, -2, 5), true);
  assert.equal(isOutOfRange(3, -2, 5), false);
  assert.equal(isOutOfRange(5, -2, 5), false);   // the bound itself is normal
});

test('an open-ended range only checks the bound it has', () => {
  assert.equal(isOutOfRange(1000, 10, null), false);
  assert.equal(isOutOfRange(2, 10, null), true);
});

test('a blank reading is not out of range', () => {
  assert.equal(isOutOfRange('', -2, 5), false);
  assert.equal(isOutOfRange(null, -2, 5), false);
});

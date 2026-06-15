// Translator-parity tests — run with `node --test`.
//
// The four MLC rules + thresholds are locked in restHours and shared by every
// HOR surface. The only place /profile, the rota Rest Log and the rota baseline
// could ever disagree is the PLUMBING that turns a day's 30-min segments into
// on-duty shifts (and back) before the engine sees them. These tests assert
// that single converter pair handles the two cases the private copies used to
// get wrong — a full 24h day and a shift crossing midnight — so identical hours
// produce identical engine inputs everywhere.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  segmentsToShifts, shiftToOnDutySegments, assessMlc, restForDay,
  workEntriesToShifts, mergeLoggedOverPlan,
} from './restHours.js';

const seq = (a, b) => Array.from({ length: b - a }, (_, i) => a + i); // [a, b)

// ── Full 24h day ────────────────────────────────────────────────────────────
// All 48 blocks worked. The old rota Rest Log encoded the end as "00:00", which
// the engine reads as 00:00→00:00 "unknown" and DROPS — so a fully-worked day
// showed as fully rested. The shared converter ends at "24:00".
test('a fully-worked day = 24h on duty / 0h rest (not dropped)', () => {
  const shifts = segmentsToShifts('2026-06-01', seq(0, 48), {});
  assert.equal(shifts.length, 1);
  assert.deepEqual(
    { s: shifts[0].startTime, e: shifts[0].endTime },
    { s: '00:00', e: '24:00' },
  );
  const { onDutyHours, rest24h } = restForDay(shifts);
  assert.equal(onDutyHours, 24);
  assert.equal(rest24h, 0);
});

// ── Overnight shift: logged (segments) vs planned (baseline) read identically ─
// 18:00→02:00 = blocks 36..47 on day 1 and 0..3 on day 2. Whether it arrives as
// painted segments (profile / rota Rest Log) or as a rota shift turned into the
// baseline, the engine must see the same per-day shifts.
test('overnight shift: baseline (shift→segments) matches logged segments', () => {
  // Baseline path: one rota shift → segments, spill carried to the next day.
  const parts = shiftToOnDutySegments('2026-06-01', '18:00', '02:00');
  assert.deepEqual(parts, [
    { date: '2026-06-01', segments: seq(36, 48) }, // 18:00–24:00
    { date: '2026-06-02', segments: seq(0, 4) },   // 00:00–02:00
  ]);

  // Logged-actuals path: the same hours painted on each calendar day.
  const loggedDay1 = seq(36, 48);
  const loggedDay2 = seq(0, 4);

  // Both paths produce identical segments per day…
  assert.deepEqual(parts[0].segments, loggedDay1);
  assert.deepEqual(parts[1].segments, loggedDay2);

  // …hence identical engine shifts and identical rest figures.
  const fromBaseline = [
    ...segmentsToShifts(parts[0].date, parts[0].segments, {}),
    ...segmentsToShifts(parts[1].date, parts[1].segments, {}),
  ];
  const fromLogged = [
    ...segmentsToShifts('2026-06-01', loggedDay1, {}),
    ...segmentsToShifts('2026-06-02', loggedDay2, {}),
  ];
  assert.deepEqual(fromBaseline, fromLogged);

  // Day 1: 6h on duty → 18h rest. Day 2: 2h on duty → 22h rest.
  assert.equal(restForDay(fromLogged.filter((s) => s.date === '2026-06-01')).rest24h, 18);
  assert.equal(restForDay(fromLogged.filter((s) => s.date === '2026-06-02')).rest24h, 22);
});

// ── Logged actuals override the plan (rota Rest Log AND planning grid) ────────
// A crew member's logged day must replace the rota plan for that member-day, so
// the rolling-rest assessment a chief sees while planning reflects what was
// actually worked — not what was merely rostered. Both surfaces share this.
test('mergeLoggedOverPlan: a logged day replaces the planned shift for that member-day', () => {
  const userToMember = new Map([['user-1', 'm1']]);
  const plan = [
    { memberId: 'm1', date: '2026-06-01', startTime: '08:00', endTime: '18:00', shiftType: 'duty' }, // rostered 10h
    { memberId: 'm1', date: '2026-06-02', startTime: '08:00', endTime: '18:00', shiftType: 'duty' }, // untouched
    { memberId: 'm2', date: '2026-06-01', startTime: '08:00', endTime: '18:00', shiftType: 'duty' }, // other member, kept
  ];
  // m1 actually worked the whole of 1 Jun (a breach the plan would never show).
  const { loggedShifts, loggedDays } = workEntriesToShifts(
    [{ subject_user_id: 'user-1', entry_date: '2026-06-01', work_segments: seq(0, 48) }],
    userToMember,
  );
  assert.ok(loggedDays.has('m1|2026-06-01'));

  const merged = mergeLoggedOverPlan(plan, loggedShifts, loggedDays);
  const m1Jun1 = merged.filter((s) => s.memberId === 'm1' && s.date === '2026-06-01');
  // Plan dropped, actual used: one 24h shift → 0h rest (breach), not the 10h plan.
  assert.deepEqual(m1Jun1.map((s) => [s.startTime, s.endTime]), [['00:00', '24:00']]);
  assert.equal(restForDay(m1Jun1).rest24h, 0);
  // Other days / members are left exactly as planned.
  assert.equal(merged.filter((s) => s.memberId === 'm1' && s.date === '2026-06-02').length, 1);
  assert.equal(merged.filter((s) => s.memberId === 'm2' && s.date === '2026-06-01').length, 1);
});

// No logged actuals ⇒ the plan passes through untouched (and by identity).
test('mergeLoggedOverPlan: empty logged set returns the plan unchanged', () => {
  const plan = [{ memberId: 'm1', date: '2026-06-01', startTime: '08:00', endTime: '18:00', shiftType: 'duty' }];
  assert.equal(mergeLoggedOverPlan(plan, [], new Set()), plan);
});

// ── The 14h continuous-on-duty rule still joins across midnight ───────────────
// A long overnight stretch split at midnight must still be assessed as one
// continuous stretch by the engine (it joins day1 24:00 ↔ day2 00:00).
test('overnight stretch joins across midnight for the 14h rule', () => {
  // 16:00→08:00 = 16h continuous. Blocks 32..47 (day1) + 0..15 (day2).
  const parts = shiftToOnDutySegments('2026-06-01', '16:00', '08:00');
  const shifts = parts.flatMap((p) => segmentsToShifts(p.date, p.segments, {}));
  const weekShifts = shifts; // 2-day window is enough for the stretch rule
  const mlc = assessMlc({ dayShifts: shifts.filter((s) => s.date === '2026-06-01'), weekShifts });
  assert.equal(Math.round(mlc.longestStretchHours), 16);
  const stretchRule = mlc.rules.find((r) => r.rule === 'max_work_stretch_14h');
  assert.equal(stretchRule.satisfied, false); // 16h > 14h → breach, as expected
});

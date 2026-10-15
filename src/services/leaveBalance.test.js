import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRotation, rotationAnnualDays, annualEntitlement, basisLabel,
  daysBetweenInclusive, accruedDays, takenDays, computeLeaveBalance,
  toHalfDays, formatDays,
  MLC_MIN_DAYS_PER_MONTH, MLC_MIN_DAYS_PER_YEAR, DAYS_PER_YEAR,
} from './leaveBalance.js';

const near = (a, b, tol = 0.01) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ~${b}, got ${a}`);

// ── rotation patterns ────────────────────────────────────────────────────────

test('rotation patterns parse, including the messy ones in the live data', () => {
  assert.deepEqual(parseRotation('4:2'), { on: 4, off: 2 });
  assert.deepEqual(parseRotation('10:10'), { on: 10, off: 10 });
  assert.deepEqual(parseRotation(' 3 : 3 '), { on: 3, off: 3 });
  assert.deepEqual(parseRotation('2/2'), { on: 2, off: 2 });
  assert.deepEqual(parseRotation('2-2'), { on: 2, off: 2 });
  // crew_employment really does contain rotation_pattern = 'Permanent'.
  assert.equal(parseRotation('Permanent'), null);
  assert.equal(parseRotation(''), null);
  assert.equal(parseRotation(null), null);
  assert.equal(parseRotation('3:0'), null, 'no time off is not a rotation');
});

test('the rotation ratio gives the days off the user described', () => {
  // "work 1 day get 1 day off then the leave is half the year"
  near(rotationAnnualDays('1:1'), DAYS_PER_YEAR / 2);   // 182.5
  near(rotationAnnualDays('4:2'), 121.67);              // "4:2 then its 120 etc"
  near(rotationAnnualDays('3:1'), 91.25);
  assert.equal(rotationAnnualDays('nonsense'), null);
});

test('the unit is irrelevant — only the ratio matters', () => {
  // 2:2 months, 3:3 months and 10:10 weeks are all 1:1, which is why
  // rotation_unit never enters the sum. Every rotational crew member in the
  // live data has 182 or 183 typed in by hand, and this is why.
  const half = DAYS_PER_YEAR / 2;
  ['2:2', '3:3', '10:10', '1:1', '6:6'].forEach((p) => near(rotationAnnualDays(p), half));
});

// ── entitlement: the minimum is a floor ──────────────────────────────────────

test('with nothing set at all, the MLC minimum applies', () => {
  const e = annualEntitlement({});
  near(e.annualDays, MLC_MIN_DAYS_PER_YEAR); // 30
  near(e.perMonth, MLC_MIN_DAYS_PER_MONTH);  // 2.5
  assert.equal(e.basis, 'mlc');
  assert.equal(e.isRotational, false);
});

test('a vessel setting it higher wins', () => {
  const e = annualEntitlement({ leave_entitlement_days: 42 });
  near(e.annualDays, 42);
  assert.equal(e.basis, 'contract');
  near(e.perMonth, 3.5);
});

test('a vessel setting it LOWER than the minimum does not win', () => {
  // The floor is statutory; a contract cannot go under it.
  const e = annualEntitlement({ leave_entitlement_days: 20 });
  near(e.annualDays, MLC_MIN_DAYS_PER_YEAR);
  assert.equal(e.basis, 'mlc');
});

test('a rotation sets its own entitlement, above both', () => {
  const e = annualEntitlement({ contract_type: 'Rotational', rotation_pattern: '2:2', rotation_unit: 'months' });
  near(e.annualDays, 182.5);
  assert.equal(e.basis, 'rotation');
  assert.equal(e.isRotational, true);
});

test('a hand-typed figure below the rotation does not reduce it', () => {
  // The live data: 2:2 with leave_entitlement_days = 182, where the rotation
  // itself is worth 182.5. The crew member keeps the better of the two.
  const e = annualEntitlement({ rotation_pattern: '2:2', leave_entitlement_days: 182 });
  near(e.annualDays, 182.5);
  assert.equal(e.basis, 'rotation');
});

test('a generous contract can still beat the rotation', () => {
  const e = annualEntitlement({ rotation_pattern: '4:2', leave_entitlement_days: 150 });
  near(e.annualDays, 150);
  assert.equal(e.basis, 'contract');
  assert.equal(e.isRotational, true, 'still a rotational contract for counting purposes');
});

test('a junk rotation pattern falls back rather than breaking', () => {
  const e = annualEntitlement({ contract_type: 'permanent', rotation_pattern: 'Permanent' });
  near(e.annualDays, MLC_MIN_DAYS_PER_YEAR);
  assert.equal(e.isRotational, false);
});

test('every basis has a label that explains the number', () => {
  assert.match(basisLabel('mlc'), /2\.5 days a month/);
  assert.equal(basisLabel('rotation', { on: 4, off: 2 }), '4:2 rotation');
  assert.equal(basisLabel('contract'), 'contract entitlement');
});

// ── accrual ──────────────────────────────────────────────────────────────────

test('day counting is inclusive, so one day of leave is one day', () => {
  assert.equal(daysBetweenInclusive('2026-03-01', '2026-03-01'), 1);
  assert.equal(daysBetweenInclusive('2026-03-01', '2026-03-31'), 31);
  assert.equal(daysBetweenInclusive('2026-03-31', '2026-03-01'), 0, 'backwards is zero');
  assert.equal(daysBetweenInclusive(null, '2026-03-01'), 0);
});

test('accrual grows every day, not in monthly steps', () => {
  // The whole point: "each month or day that passes since they started".
  const a = accruedDays('2026-01-01', '2026-01-31', 30);
  const b = accruedDays('2026-01-01', '2026-02-01', 30);
  assert.ok(b > a, 'a day later must be more');
  near(a, (30 * 31) / 365);
});

test('a full year accrues the full entitlement', () => {
  near(accruedDays('2026-01-01', '2026-12-31', 30), 30);
  near(accruedDays('2026-01-01', '2026-12-31', 182.5), 182.5);
});

test('accrual needs a positive entitlement and a real span', () => {
  assert.equal(accruedDays('2026-01-01', '2026-06-01', 0), 0);
  assert.equal(accruedDays(null, '2026-06-01', 30), 0);
});

// ── days taken ───────────────────────────────────────────────────────────────

const ch = (day, status) => ({ changed_at: `${day}T09:00:00Z`, new_status: status });

test('a four-day leave reads as four days', () => {
  // The user's example: "oh she's taken 4 days".
  const t = takenDays([ch('2026-06-10', 'on_leave'), ch('2026-06-14', 'active')], {
    startIso: '2026-01-01', asOfIso: '2026-06-30',
  });
  assert.equal(t.onLeave, 4, '10th, 11th, 12th, 13th');
  assert.equal(t.taken, 4);
});

test('leave still open-ended counts up to today and no further', () => {
  const t = takenDays([ch('2026-06-10', 'on_leave')], {
    startIso: '2026-01-01', asOfIso: '2026-06-12',
  });
  assert.equal(t.taken, 3);
});

test('a status change dated in the future is not deducted yet', () => {
  // Command can schedule one ahead in the status modal. Leave that hasn't
  // happened must not come off the balance.
  const t = takenDays([ch('2026-12-01', 'on_leave')], {
    startIso: '2026-01-01', asOfIso: '2026-06-30',
  });
  assert.equal(t.taken, 0);
});

test('medical, training and travel are never charged to annual leave', () => {
  const t = takenDays([
    ch('2026-02-01', 'medical_leave'), ch('2026-02-06', 'active'),
    ch('2026-03-01', 'training_leave'), ch('2026-03-03', 'active'),
    ch('2026-04-01', 'travelling'), ch('2026-04-02', 'active'),
  ], { startIso: '2026-01-01', asOfIso: '2026-05-01' });
  assert.equal(t.taken, 0, 'none of these spend annual leave');
  assert.equal(t.notCounted, 5 + 2 + 1);
  assert.equal(t.byStatus.medical_leave, 5);
});

test('an unrecognised status is not charged either', () => {
  // Better to under-deduct than invent a deduction for a status nobody defined.
  const t = takenDays([ch('2026-02-01', 'sabbatical'), ch('2026-02-04', 'active')], {
    startIso: '2026-01-01', asOfIso: '2026-03-01',
  });
  assert.equal(t.taken, 0);
  assert.equal(t.notCounted, 3);
});

test('rotational leave counts for rotational crew and not for anyone else', () => {
  const changes = [ch('2026-02-01', 'rotational_leave'), ch('2026-03-01', 'active')];
  const range = { startIso: '2026-01-01', asOfIso: '2026-04-01' };

  const rota = takenDays(changes, { ...range, isRotational: true });
  assert.equal(rota.rotational, 28);
  assert.equal(rota.taken, 28, 'the rotation is their leave, so it spends it');

  const perm = takenDays(changes, { ...range, isRotational: false });
  assert.equal(perm.rotational, 28);
  assert.equal(perm.taken, 0, 'a permanent contract should not be charged rotation');
  assert.equal(perm.notCounted, 28);
});

test('leave that began before the start date only counts from the start', () => {
  const t = takenDays([ch('2025-12-20', 'on_leave'), ch('2026-01-05', 'active')], {
    startIso: '2026-01-01', asOfIso: '2026-02-01',
  });
  assert.equal(t.taken, 4, '1st to 4th January');
});

test('changes in any order give the same answer', () => {
  const a = [ch('2026-06-14', 'active'), ch('2026-06-10', 'on_leave')];
  const b = [ch('2026-06-10', 'on_leave'), ch('2026-06-14', 'active')];
  const range = { startIso: '2026-01-01', asOfIso: '2026-06-30' };
  assert.deepEqual(takenDays(a, range).taken, takenDays(b, range).taken);
});

test('no history means nothing taken, not an error', () => {
  const t = takenDays([], { startIso: '2026-01-01', asOfIso: '2026-06-30' });
  assert.equal(t.taken, 0);
  assert.deepEqual(takenDays(null, { startIso: '2026-01-01', asOfIso: '2026-06-30' }).taken, 0);
});

test('malformed history rows are skipped', () => {
  const t = takenDays([null, {}, { changed_at: '2026-06-10' }, ch('2026-06-10', 'on_leave')], {
    startIso: '2026-06-01', asOfIso: '2026-06-12',
  });
  assert.equal(t.taken, 3);
});

// ── the whole balance ────────────────────────────────────────────────────────

test('the headline case: 4 taken, and what is left', () => {
  const r = computeLeaveBalance({
    employment: { start_date: '2026-01-01', leave_entitlement_days: 42 },
    changes: [ch('2026-06-10', 'on_leave'), ch('2026-06-14', 'active')],
    asOf: '2026-06-30',
  });
  assert.equal(r.ok, true);
  assert.equal(r.taken, 4);
  near(r.accrued, (42 * 181) / 365);     // 1 Jan – 30 Jun inclusive
  near(r.remaining, r.accrued - 4);
  assert.equal(r.basis, 'contract');
});

test('a 4:2 rotational crew member is measured against their rotation', () => {
  const r = computeLeaveBalance({
    employment: { start_date: '2026-01-01', contract_type: 'Rotational', rotation_pattern: '4:2', rotation_unit: 'months' },
    changes: [ch('2026-05-01', 'rotational_leave'), ch('2026-07-01', 'active')],
    asOf: '2026-07-01',
  });
  near(r.annualDays, 121.67);
  assert.equal(r.taken, 61, 'May and June on rotation');
  assert.equal(r.basis, 'rotation');
  assert.equal(r.isRotational, true);
});

test('no start date is reported, not guessed at', () => {
  // 19 employment rows in the live data have no contract details at all.
  const r = computeLeaveBalance({ employment: { leave_entitlement_days: 30 }, changes: [] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-start-date');
  assert.equal(r.accrued, 0);
});

test('a contract that has not started yet is reported too', () => {
  const r = computeLeaveBalance({
    employment: { start_date: '2027-01-01' }, changes: [], asOf: '2026-06-30',
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-started');
});

test('taking more than accrued goes negative rather than clamping to zero', () => {
  // An overdrawn balance is a real state that Command needs to see.
  const r = computeLeaveBalance({
    employment: { start_date: '2026-06-01' },
    changes: [ch('2026-06-02', 'on_leave')],
    asOf: '2026-06-30',
  });
  assert.ok(r.taken > r.accrued);
  assert.ok(r.remaining < 0, `remaining was ${r.remaining}`);
});

test('missing employment entirely does not throw', () => {
  assert.doesNotThrow(() => computeLeaveBalance({}));
  assert.equal(computeLeaveBalance({}).ok, false);
  assert.equal(computeLeaveBalance().ok, false);
});

test('a balance that has banked more than a year is flagged, not just printed', () => {
  // The real case that prompted this: a 3:3 rotation running since April 2024
  // with nothing logged shows 453 days accrued and 0 taken. Correct arithmetic,
  // useless number — almost certainly leave taken without a status change.
  const r = computeLeaveBalance({
    employment: { start_date: '2024-04-22', contract_type: 'Rotational', rotation_pattern: '3:3' },
    changes: [],
    asOf: '2026-10-15',
  });
  assert.equal(r.ok, true);
  assert.ok(r.accrued > 400);
  assert.equal(r.banked, true, 'must be flagged as implausible');
  assert.equal(r.overdrawn, false);
});

test('an ordinary balance is not flagged as banked', () => {
  const r = computeLeaveBalance({
    employment: { start_date: '2026-01-01', leave_entitlement_days: 42 },
    changes: [ch('2026-06-10', 'on_leave'), ch('2026-06-14', 'active')],
    asOf: '2026-06-30',
  });
  assert.equal(r.banked, false);
  assert.equal(r.overdrawn, false);
});

test('overdrawn is flagged for the caller', () => {
  const r = computeLeaveBalance({
    employment: { start_date: '2026-06-01' },
    changes: [ch('2026-06-02', 'on_leave')],
    asOf: '2026-06-30',
  });
  assert.equal(r.overdrawn, true);
});

test('it says where the status log starts, so a short log is visible', () => {
  const r = computeLeaveBalance({
    employment: { start_date: '2024-01-01', leave_entitlement_days: 30 },
    changes: [ch('2026-05-01', 'on_leave'), ch('2026-05-03', 'active')],
    asOf: '2026-06-01',
  });
  assert.equal(r.historyFrom, '2026-05-01');
  assert.equal(r.historyStartsLate, true, 'two years of service are not covered by the log');
});

// ── presentation ─────────────────────────────────────────────────────────────

test('days are shown in halves, not to five decimal places', () => {
  assert.equal(toHalfDays(16.43), 16.5);
  assert.equal(toHalfDays(16.2), 16);
  assert.equal(formatDays(16.43), '16.5 days');
  assert.equal(formatDays(1), '1 day');
  assert.equal(formatDays(-1), '-1 day');
  assert.equal(formatDays(0), '0 days');
});

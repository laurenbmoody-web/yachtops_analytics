// Leave accrual and balance — pure, no DOM and no Supabase, so the arithmetic is
// testable with `node --test`. The money question it answers is "she's taken 4
// days and has 16 left", which until now nothing in Cargo could say.
//
// THREE INPUTS, AND WHERE THEY COME FROM
//   * crew_employment.start_date          — when accrual starts
//   * crew_employment.leave_entitlement_days / rotation_pattern / rotation_unit
//   * crew_status_history                 — every status change, with a date
//
// ENTITLEMENT: THE MINIMUM IS A FLOOR, NOT A DEFAULT
// MLC 2006 sets paid annual leave at not less than 2.5 days per month of
// employment. So the vessel's own figure and the rotation both RAISE the
// entitlement and neither can lower it — the floor is applied last.
//
// ROTATION DEFINES ITS OWN LEAVE
// A rotational contract isn't "work, plus some leave" — the time off IS the
// deal. 1:1 is half the year off; 4:2 is a third. Crucially the ratio is
// UNIT-INDEPENDENT: 2:2 months, 3:3 months and 10:10 weeks all reduce to 1:1, so
// rotation_unit never enters the sum. (The live data bears this out — every
// rotational crew member on the boat has had 182 or 183 typed in by hand.)
//
// WHAT COUNTS AS TAKEN
// For rotational crew, days on rotation spend the entitlement the rotation
// created, so 'rotational_leave' and 'on_leave' both count. For everyone else
// only 'on_leave' counts. Medical and training leave and travelling days never
// count against annual leave — they are reported separately rather than
// silently folded in, because quietly charging someone's sick leave to their
// holiday is the kind of error nobody forgives.

// MLC 2006 Reg 2.4 — the statutory floor.
export const MLC_MIN_DAYS_PER_MONTH = 2.5;
export const MLC_MIN_DAYS_PER_YEAR = MLC_MIN_DAYS_PER_MONTH * 12; // 30

// Accrual is pro-rated across the year rather than stepping on a monthly
// anniversary, so the figure moves every day the way the crew expect it to.
export const DAYS_PER_YEAR = 365;

// Statuses that spend annual leave, by contract shape.
const SPENDS_ALWAYS = new Set(['on_leave']);
const SPENDS_IF_ROTATIONAL = new Set(['rotational_leave']);
// Away, but not annual leave. Counted and shown, never deducted.
const AWAY_NOT_LEAVE = new Set(['medical_leave', 'training_leave', 'travelling']);

// ── rotation ─────────────────────────────────────────────────────────────────

// "4:2" → { on: 4, off: 2 }. Tolerates "4 : 2", "4/2", "4-2" and junk like
// "Permanent" (which really is in the data) by returning null.
export const parseRotation = (pattern) => {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:/\-]\s*(\d+(?:\.\d+)?)\s*$/.exec(String(pattern ?? ''));
  if (!m) return null;
  const on = Number(m[1]);
  const off = Number(m[2]);
  if (!(on > 0) || !(off > 0)) return null; // 3:0 is not a rotation
  return { on, off };
};

// Days off per year implied by a rotation. Unit-free: only the ratio matters.
export const rotationAnnualDays = (pattern) => {
  const r = parseRotation(pattern);
  if (!r) return null;
  return (DAYS_PER_YEAR * r.off) / (r.on + r.off);
};

// ── entitlement ──────────────────────────────────────────────────────────────

// The annual entitlement, and which input decided it — the screen says this out
// loud so nobody has to guess why the number is what it is.
export const annualEntitlement = (employment = {}) => {
  const stated = Number(employment.leave_entitlement_days);
  const statedDays = Number.isFinite(stated) && stated > 0 ? stated : null;
  const rotationDays = rotationAnnualDays(employment.rotation_pattern);

  const candidates = [
    { days: MLC_MIN_DAYS_PER_YEAR, basis: 'mlc' },
    ...(statedDays !== null ? [{ days: statedDays, basis: 'contract' }] : []),
    ...(rotationDays !== null ? [{ days: rotationDays, basis: 'rotation' }] : []),
  ];
  // Highest wins, so the statutory minimum can only ever raise the result.
  // Ties prefer the more specific explanation (rotation, then contract).
  const rank = { rotation: 3, contract: 2, mlc: 1 };
  const best = candidates.reduce((a, b) => {
    if (b.days > a.days + 1e-9) return b;
    if (Math.abs(b.days - a.days) <= 1e-9 && rank[b.basis] > rank[a.basis]) return b;
    return a;
  });

  return {
    annualDays: best.days,
    perMonth: best.days / 12,
    basis: best.basis,
    rotation: parseRotation(employment.rotation_pattern),
    isRotational: rotationDays !== null,
  };
};

export const basisLabel = (basis, rotation) => ({
  rotation: rotation ? `${rotation.on}:${rotation.off} rotation` : 'rotation',
  contract: 'contract entitlement',
  mlc: 'MLC minimum (2.5 days a month)',
}[basis] || 'contract entitlement');

// ── dates (UTC throughout) ───────────────────────────────────────────────────
// All date handling is UTC-on-strings. Mixing local Date construction with
// toISOString() shifts the day either side of midnight depending on the device's
// timezone, which on a boat that changes timezone regularly would make a leave
// balance drift by a day for no visible reason.

const toUtc = (iso) => {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const dayKey = (d) => d.toISOString().slice(0, 10);
const DAY_MS = 86400000;

// Inclusive day count, so a single-day leave reads as 1 rather than 0.
export const daysBetweenInclusive = (fromIso, toIso) => {
  const a = toUtc(fromIso);
  const b = toUtc(toIso);
  if (!a || !b || b < a) return 0;
  return Math.round((b - a) / DAY_MS) + 1;
};

// ── accrual ──────────────────────────────────────────────────────────────────

export const accruedDays = (startIso, asOfIso, annualDays) => {
  const served = daysBetweenInclusive(startIso, asOfIso);
  if (!served || !(annualDays > 0)) return 0;
  return (annualDays * served) / DAYS_PER_YEAR;
};

// ── days taken ───────────────────────────────────────────────────────────────

// Walk the service day by day, carrying the status in effect, and tally.
//
// `changes` is [{ changed_at, new_status }] in any order; it gets sorted here.
// A change dated in the future is ignored for today's figure — the status modal
// lets Command schedule one ahead, and leave that hasn't happened yet must not
// come off the balance.
export const takenDays = (changes = [], { startIso, asOfIso, isRotational = false } = {}) => {
  const zero = { taken: 0, onLeave: 0, rotational: 0, notCounted: 0, byStatus: {} };
  const start = toUtc(startIso);
  const asOf = toUtc(asOfIso);
  if (!start || !asOf || asOf < start) return zero;

  const sorted = (changes || [])
    .filter((c) => c && c.changed_at && c.new_status)
    .map((c) => ({ day: String(c.changed_at).slice(0, 10), status: String(c.new_status) }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  const out = { ...zero, byStatus: {} };
  let idx = 0;
  // Status before the window: the last change dated on or before the start day.
  let status = 'active';
  const startDay = dayKey(start);
  while (idx < sorted.length && sorted[idx].day <= startDay) { status = sorted[idx].status; idx += 1; }

  for (let t = start.getTime(); t <= asOf.getTime(); t += DAY_MS) {
    const day = dayKey(new Date(t));
    while (idx < sorted.length && sorted[idx].day <= day) { status = sorted[idx].status; idx += 1; }
    if (status === 'active') continue;

    out.byStatus[status] = (out.byStatus[status] || 0) + 1;
    if (SPENDS_ALWAYS.has(status)) { out.onLeave += 1; out.taken += 1; }
    else if (SPENDS_IF_ROTATIONAL.has(status)) {
      out.rotational += 1;
      if (isRotational) out.taken += 1; else out.notCounted += 1;
    } else if (AWAY_NOT_LEAVE.has(status)) out.notCounted += 1;
    // Any status we don't recognise is away-but-not-counted: better to
    // under-deduct than to charge someone for a status nobody has defined.
    else out.notCounted += 1;
  }
  return out;
};

// ── the whole balance ────────────────────────────────────────────────────────

// Returns everything the card needs, including why it can't answer when it
// can't. `reason` is the one field the UI must check first.
export const computeLeaveBalance = ({ employment, changes = [], asOf } = {}) => {
  const asOfIso = String(asOf || new Date().toISOString()).slice(0, 10);
  const ent = annualEntitlement(employment || {});
  const startIso = employment?.start_date ? String(employment.start_date).slice(0, 10) : null;

  if (!startIso) {
    return {
      ok: false,
      reason: 'no-start-date',
      ...ent,
      asOf: asOfIso,
      servedDays: 0, accrued: 0, taken: 0, remaining: 0,
      onLeave: 0, rotational: 0, notCounted: 0, byStatus: {},
    };
  }
  if (toUtc(startIso) > toUtc(asOfIso)) {
    return {
      ok: false,
      reason: 'not-started',
      ...ent,
      asOf: asOfIso, startDate: startIso,
      servedDays: 0, accrued: 0, taken: 0, remaining: 0,
      onLeave: 0, rotational: 0, notCounted: 0, byStatus: {},
    };
  }

  const servedDays = daysBetweenInclusive(startIso, asOfIso);
  const accrued = accruedDays(startIso, asOfIso, ent.annualDays);
  const t = takenDays(changes, { startIso, asOfIso, isRotational: ent.isRotational });
  const remaining = accrued - t.taken;

  // The balance is only as good as the status log, and on real data that bites:
  // a crew member on a 3:3 rotation since April 2024 with nothing logged shows
  // 453 days accrued and none taken. Arithmetically right, practically useless.
  // So say when a balance has banked more than a full year, which in practice
  // means leave was taken without the status being changed in Cargo. The caller
  // shows a caution rather than presenting the figure as settled.
  const banked = remaining > ent.annualDays;

  // When the status log starts long after the contract did, everything before
  // it is invisible to the count — worth showing alongside the number.
  const firstChange = (changes || [])
    .filter((c) => c && c.changed_at)
    .map((c) => String(c.changed_at).slice(0, 10))
    .sort()[0] || null;

  return {
    ok: true,
    reason: null,
    ...ent,
    asOf: asOfIso,
    startDate: startIso,
    servedDays,
    accrued,
    taken: t.taken,
    // Can go negative — someone who has taken more than they've accrued is a
    // real and important state, so it is shown rather than clamped to zero.
    remaining,
    overdrawn: remaining < 0,
    banked,
    historyFrom: firstChange,
    // True when the log cannot possibly cover the service — the figure is a
    // lower bound on leave taken, not a settled balance.
    historyStartsLate: !!(firstChange && firstChange > startIso),
    onLeave: t.onLeave,
    rotational: t.rotational,
    notCounted: t.notCounted,
    byStatus: t.byStatus,
  };
};

// Leave is conventionally handled in half days; show it that way rather than
// printing 16.43 days at someone.
export const toHalfDays = (n) => Math.round((Number(n) || 0) * 2) / 2;

export const formatDays = (n) => {
  const h = toHalfDays(n);
  const s = Number.isInteger(h) ? String(h) : h.toFixed(1);
  return `${s} ${Math.abs(h) === 1 ? 'day' : 'days'}`;
};

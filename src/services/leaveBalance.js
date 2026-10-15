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

// ── leave years and carry-over ───────────────────────────────────────────────
//
// A leave year only exists if a vessel asks for one. The default anchor is
// 'none', which is one continuous period from the contract start — exactly how
// the balance behaved before this existed. That default is deliberate and
// important: forfeiting someone's accrued leave because of an unconfigured
// setting would be the worst possible failure of this feature.

export const DEFAULT_LEAVE_POLICY = { anchor: 'none', carryOverMaxDays: null };

export const normalisePolicy = (policy = {}) => {
  const anchor = ['none', 'contract', 'calendar'].includes(policy?.anchor) ? policy.anchor : 'none';
  const raw = Number(policy?.carryOverMaxDays);
  return {
    anchor,
    // A cap only means anything alongside a leave year, and a negative cap is
    // nonsense — both collapse to "no limit".
    carryOverMaxDays: anchor !== 'none' && Number.isFinite(raw) && raw >= 0 ? raw : null,
  };
};

const addYears = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  // Clamp 29 Feb to the 28th in a non-leap year rather than rolling into March.
  const target = new Date(Date.UTC(y + n, m - 1, d));
  if (target.getUTCMonth() !== m - 1) target.setUTCDate(0);
  return dayKey(target);
};

const dayBefore = (iso) => dayKey(new Date(toUtc(iso).getTime() - DAY_MS));

// The leave-year windows covering [start, asOf], oldest first, each
// { from, to, closed }. With anchor 'none' that is a single open window.
export const leaveYears = (startIso, asOfIso, anchor) => {
  if (anchor === 'none' || !startIso || !asOfIso) {
    return [{ from: startIso, to: asOfIso, closed: false }];
  }
  // Where the first boundary falls: the contract anniversary, or 1 January.
  let edge = anchor === 'calendar'
    ? `${Number(startIso.slice(0, 4)) + 1}-01-01`
    : addYears(startIso, 1);

  const out = [];
  let from = startIso;
  while (edge <= asOfIso) {
    out.push({ from, to: dayBefore(edge), closed: true });
    from = edge;
    edge = anchor === 'calendar' ? `${Number(edge.slice(0, 4)) + 1}-01-01` : addYears(edge, 1);
  }
  out.push({ from, to: asOfIso, closed: false });
  return out;
};

// Signed adjustment days falling inside a window.
export const adjustmentsInWindow = (adjustments = [], fromIso, toIso) =>
  (adjustments || []).reduce((sum, a) => {
    if (!a || !a.effective_date) return sum;
    const d = String(a.effective_date).slice(0, 10);
    if (d < fromIso || d > toIso) return sum;
    const n = Number(a.days);
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);

// ── the whole balance ────────────────────────────────────────────────────────

// Returns everything the card needs, including why it can't answer when it
// can't. `reason` is the one field the UI must check first.
//
// `adjustments` are signed day counts from crew_leave_adjustments — positive
// grants days, negative removes them — landed in a leave year by effective_date.
// `policy` is the vessel's leave year and carry-over cap; omitted, it is one
// continuous period with nothing forfeited.
export const computeLeaveBalance = ({
  employment, changes = [], adjustments = [], policy, asOf,
} = {}) => {
  const asOfIso = String(asOf || new Date().toISOString()).slice(0, 10);
  const ent = annualEntitlement(employment || {});
  const pol = normalisePolicy(policy);
  const startIso = employment?.start_date ? String(employment.start_date).slice(0, 10) : null;

  const blank = {
    ...ent,
    policy: pol,
    asOf: asOfIso,
    servedDays: 0,
    opening: 0, accrued: 0, taken: 0, adjustments: 0, remaining: 0,
    forfeited: 0, years: [],
    onLeave: 0, rotational: 0, notCounted: 0, byStatus: {},
    lifetime: { taken: 0, onLeave: 0, rotational: 0, notCounted: 0 },
    overdrawn: false, banked: false, historyFrom: null, historyStartsLate: false,
  };

  if (!startIso) return { ok: false, reason: 'no-start-date', ...blank };
  if (toUtc(startIso) > toUtc(asOfIso)) {
    return { ok: false, reason: 'not-started', ...blank, startDate: startIso };
  }

  // Walk the leave years in order, carrying a (possibly capped) closing balance
  // into the next. With anchor 'none' this is a single open window and the loop
  // runs once, which is why the default behaves exactly as it did before.
  const windows = leaveYears(startIso, asOfIso, pol.anchor);
  const years = [];
  let opening = 0;
  let forfeited = 0;

  windows.forEach((w) => {
    const accrued = accruedDays(w.from, w.to, ent.annualDays);
    const t = takenDays(changes, { startIso: w.from, asOfIso: w.to, isRotational: ent.isRotational });
    const adj = adjustmentsInWindow(adjustments, w.from, w.to);
    const closing = opening + accrued + adj - t.taken;

    // Forfeiture only ever applies to a year that has actually ENDED, and only
    // when a vessel set a cap. A debt always carries in full — capping a
    // negative balance would quietly forgive leave someone has overdrawn.
    let carried = closing;
    if (w.closed && pol.carryOverMaxDays !== null && closing > pol.carryOverMaxDays) {
      carried = pol.carryOverMaxDays;
      forfeited += closing - carried;
    }

    years.push({
      from: w.from, to: w.to, closed: w.closed,
      opening, accrued, taken: t.taken, adjustments: adj, closing, carried,
      forfeited: closing - carried,
    });
    if (w.closed) opening = carried;
  });

  const cur = years[years.length - 1];
  const life = takenDays(changes, { startIso, asOfIso, isRotational: ent.isRotational });
  const curAway = takenDays(changes, {
    startIso: cur.from, asOfIso: cur.to, isRotational: ent.isRotational,
  });

  const remaining = cur.closing;
  const banked = remaining > ent.annualDays;
  const firstChange = (changes || [])
    .filter((c) => c && c.changed_at)
    .map((c) => String(c.changed_at).slice(0, 10))
    .sort()[0] || null;

  return {
    ok: true,
    reason: null,
    ...ent,
    policy: pol,
    asOf: asOfIso,
    startDate: startIso,
    servedDays: daysBetweenInclusive(startIso, asOfIso),

    // The current leave year (or the whole service, with anchor 'none').
    yearFrom: cur.from,
    yearTo: cur.to,
    opening: cur.opening,
    accrued: cur.accrued,
    taken: cur.taken,
    adjustments: cur.adjustments,
    remaining,
    overdrawn: remaining < 0,
    forfeited,
    years,

    onLeave: curAway.onLeave,
    rotational: curAway.rotational,
    notCounted: curAway.notCounted,
    byStatus: curAway.byStatus,
    lifetime: {
      taken: life.taken, onLeave: life.onLeave,
      rotational: life.rotational, notCounted: life.notCounted,
    },

    banked,
    historyFrom: firstChange,
    historyStartsLate: !!(firstChange && firstChange > startIso),
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

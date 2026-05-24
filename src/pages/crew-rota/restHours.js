// MLC 2006 / STCW rest-hour utility — shared by the rota grid, the rest
// panel, and the apply-time compliance check.
//
// Four rules, all enforced by the same `assessMlc({dayShifts, weekShifts})`
// entry:
//   1. ≥10h rest in any 24h window               (daily_rest_10h)
//   2. ≥77h rest in any 7-day window             (weekly_rest_77h)
//   3. Rest in ≤2 periods, one period ≥6h        (rest_period_split)
//   4. ≤14h continuous on-duty stretch           (max_work_stretch_14h)
//
// Shifts go in as `{ date, startTime, endTime, shiftType }` (camelCase).
// Callers reading the DB directly (snake_case) must adapt at the boundary.
// Overnight shifts (end <= start) are extended past 24h internally;
// nothing in here uses Date#toISOString — date components are local.

export const ON_DUTY_TYPES = new Set(['duty', 'watch', 'standby', 'training']);

export const MLC_DAILY_REST_MIN = 10;       // hours
export const MLC_WEEKLY_REST_MIN = 77;      // hours
export const MLC_MAX_REST_PERIODS = 2;
export const MLC_LONGEST_REST_PERIOD_MIN = 6;
export const MLC_MAX_WORK_STRETCH = 14;     // hours

// Circadian (soft, net-new). Tune by editing here — single source of truth.
export const CIRCADIAN_MIDPOINT_DELTA_H = 8;   // ≥ this midpoint shift = a "swing"
export const CIRCADIAN_SWING_THRESHOLD = 2;    // ≥ this many in the window = flag
export const CIRCADIAN_WINDOW_DAYS = 7;        // rolling window size

function hhmmToDecimal(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return h + (m || 0) / 60;
}

// Normalise on-duty shifts in one day into decimal-hour ranges. Overnight
// shifts extend past 24 (the caller decides whether to clip to [0, 24]).
function onDutyRanges(dayShifts) {
  return (dayShifts || [])
    .filter(s => ON_DUTY_TYPES.has(s.shiftType))
    .map(s => {
      const start = hhmmToDecimal(s.startTime);
      let end = hhmmToDecimal(s.endTime);
      if (start == null || end == null) return null;
      if (end <= start) end += 24;
      return { start, end };
    })
    .filter(Boolean);
}

// Rule 1 — daily on-duty totals and the implied 24h rest figure.
export function restForDay(dayShifts) {
  const onDutyHours = onDutyRanges(dayShifts)
    .reduce((sum, r) => sum + (r.end - r.start), 0);
  const rest24h = Math.max(0, 24 - onDutyHours);
  return { onDutyHours, rest24h };
}

// Rule 2 — rolling 7-day on-duty totals + implied rest figure.
export function restForWeek(weekShifts) {
  const onDutyHours = onDutyRanges(weekShifts)
    .reduce((sum, r) => sum + (r.end - r.start), 0);
  const pastWeekHours = Math.max(0, 7 * 24 - onDutyHours);
  return { onDutyHours, pastWeekHours };
}

// Rule 3 — rest within a single 24h day must fall in ≤2 periods, one ≥6h.
// We invert on-duty blocks (clipped to [0, 24]) to derive rest periods.
export function restPeriodSplit(dayShifts) {
  const blocks = onDutyRanges(dayShifts)
    .map(r => ({ start: Math.max(0, r.start), end: Math.min(24, r.end) }))
    .filter(r => r.end > r.start)
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const b of blocks) {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else merged.push({ ...b });
  }

  const periods = [];
  let cursor = 0;
  for (const b of merged) {
    if (b.start > cursor) periods.push({ start: cursor, end: b.start, length: b.start - cursor });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < 24) periods.push({ start: cursor, end: 24, length: 24 - cursor });

  const longest = periods.length > 0 ? Math.max(...periods.map(p => p.length)) : 0;
  const periodCount = periods.length;
  const satisfied =
    periodCount <= MLC_MAX_REST_PERIODS && longest >= MLC_LONGEST_REST_PERIOD_MIN;
  return { periods, periodCount, longest, satisfied };
}

// Rule 4 — longest continuous on-duty stretch across the week. Adjacent
// shifts that touch (same end as next start) merge into one stretch.
// Requires `s.date` ('YYYY-MM-DD') alongside the times.
export function maxWorkStretch(weekShifts) {
  const intervals = [];
  for (const s of (weekShifts || [])) {
    if (!ON_DUTY_TYPES.has(s.shiftType) || !s.date) continue;
    const startDec = hhmmToDecimal(s.startTime);
    let endDec = hhmmToDecimal(s.endTime);
    if (startDec == null || endDec == null) continue;
    if (endDec <= startDec) endDec += 24;
    const [y, m, d] = String(s.date).split('-').map(Number);
    if (!y || !m || !d) continue;
    const dayMs = new Date(y, m - 1, d).getTime();
    intervals.push({
      startMs: dayMs + startDec * 3_600_000,
      endMs: dayMs + endDec * 3_600_000,
    });
  }
  intervals.sort((a, b) => a.startMs - b.startMs);

  let longestMs = 0;
  let curStart = null;
  let curEnd = null;
  for (const iv of intervals) {
    if (curEnd == null) {
      curStart = iv.startMs; curEnd = iv.endMs;
    } else if (iv.startMs <= curEnd) {
      curEnd = Math.max(curEnd, iv.endMs);
    } else {
      longestMs = Math.max(longestMs, curEnd - curStart);
      curStart = iv.startMs; curEnd = iv.endMs;
    }
  }
  if (curEnd != null) longestMs = Math.max(longestMs, curEnd - curStart);

  const longestStretchHours = longestMs / 3_600_000;
  return {
    longestStretchHours,
    satisfied: longestStretchHours <= MLC_MAX_WORK_STRETCH,
  };
}

// One-shot per-rule report. `dayShifts` is one member's on-duty shifts for
// the target day; `weekShifts` is the rolling 7-day window. The four rule
// rows are stable in name/order so the UI can key on `rule`.
export function assessMlc({ dayShifts = [], weekShifts = [] } = {}) {
  const { onDutyHours: onDutyToday, rest24h } = restForDay(dayShifts);
  const { onDutyHours: onDutyWeek, pastWeekHours } = restForWeek(weekShifts);
  const split = restPeriodSplit(dayShifts);
  const stretch = maxWorkStretch(weekShifts);

  const rules = [
    {
      rule: 'daily_rest_10h',
      label: '10h rest in any 24h',
      satisfied: rest24h >= MLC_DAILY_REST_MIN,
      actual: rest24h,
      limit: MLC_DAILY_REST_MIN,
    },
    {
      rule: 'weekly_rest_77h',
      label: '77h rest in any 7 days',
      satisfied: pastWeekHours >= MLC_WEEKLY_REST_MIN,
      actual: pastWeekHours,
      limit: MLC_WEEKLY_REST_MIN,
    },
    {
      rule: 'rest_period_split',
      label: 'Rest in ≤2 periods, one ≥6h',
      satisfied: split.satisfied,
      actual: { periodCount: split.periodCount, longest: split.longest },
      limit: { maxPeriods: MLC_MAX_REST_PERIODS, longestMin: MLC_LONGEST_REST_PERIOD_MIN },
    },
    {
      rule: 'max_work_stretch_14h',
      label: 'Max 14h continuous on-duty',
      satisfied: stretch.satisfied,
      actual: stretch.longestStretchHours,
      limit: MLC_MAX_WORK_STRETCH,
    },
  ];
  const breaches = rules.filter(r => !r.satisfied);

  return {
    onDutyToday,
    onDutyWeek,
    rest24h,
    pastWeekHours,
    restPeriods: split.periods,
    longestStretchHours: stretch.longestStretchHours,
    rules,
    breaches,
    anyBreach: breaches.length > 0,
  };
}

// ── Forward-looking apply-time compliance check ────────────────────────────
// Called once before the apply commits. For each proposed (member, date) it
// re-runs assessMlc against `existing ∪ proposed` for that member, anchoring
// the 7-day rolling window on each apply date. Breaches and circadian
// "swings" (≥CIRCADIAN_MIDPOINT_DELTA_H midpoint shift between consecutive
// on-duty shifts) are aggregated per member.
//
// Inputs are intentionally permissive — `proposedRows` can be the modal's
// row builder output (snake_case `member_id`, `shift_date`, `start_time`,
// etc.) and `existingWindowShifts` can be raw DB rows in the same shape.
// We normalise to camelCase internally.
//
// Returns:
//   {
//     byMember: { [memberId]: { mlcBreaches: [...], circadianFlags: [...] } },
//     hasMlc:   boolean,
//     hasCircadian: boolean,
//     totalMlcBreaches: number,
//     totalCircadianFlags: number,
//   }

function pad(n) { return String(n).padStart(2, '0'); }
function toLocalDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addLocalDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const x = new Date(y, m - 1, d);
  x.setDate(x.getDate() + n);
  return toLocalDateStr(x);
}

function normalise(rows, source) {
  return (rows || []).map((r) => ({
    memberId: r.member_id ?? r.memberId,
    date: r.shift_date ?? r.date,
    startTime: r.start_time ?? r.startTime,
    endTime: r.end_time ?? r.endTime,
    shiftType: r.shift_type ?? r.shiftType,
    subType: r.sub_type ?? r.subType ?? null,
    source,
  })).filter((s) => s.memberId && s.date);
}

// ── Breach attribution (v1: totals rules only) ─────────────────────────────
// Pure function. Takes a single breach + the shifts it was computed from
// and returns a machine-friendly diagnosis the UI can copy-render. Returns
// null for the two structural rules — those get no advisory in v1.
//
// `dayShifts` / `weekShifts` items are camelCase + source-tagged
// ('existing' | 'proposed') as emitted by assessApply.

function enrichOnDuty(shifts) {
  return (shifts || [])
    .filter((s) => ON_DUTY_TYPES.has(s.shiftType))
    .map((s) => {
      const start = hhmmToDecimal(s.startTime);
      let end = hhmmToDecimal(s.endTime);
      if (start == null || end == null) return null;
      if (end <= start) end += 24;
      return {
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        source: s.source || null,
        startDec: start,
        endDec: end,
        durationHours: end - start,
      };
    })
    .filter(Boolean);
}

function diagnoseDaily({ date, dayShifts }) {
  const shifts = enrichOnDuty((dayShifts || []).filter((s) => s.date === date))
    .sort((a, b) => a.startDec - b.startDec);
  const culpritOf = (s) => ({
    date: s.date,
    startTime: s.startTime,
    endTime: s.endTime,
    source: s.source,
    durationHours: s.durationHours,
  });
  const n = shifts.length;
  if (n === 0) {
    return { rule: 'daily_rest_10h', date, cause: 'ambiguous', culprits: [] };
  }
  // Dominance check (applies for any shift count, n=1 included). A single
  // shift "dominates" the day if it accounts for ≥75 % of on-duty hours OR
  // is itself already at/over the alone-breach threshold (≥14h leaves <10h
  // rest in 24h regardless of anything else). In either case the long
  // shift IS the cause — the n-based branches below would otherwise route
  // a 16h + 1h handover day to "two shifts too close", which gives the
  // wrong advice.
  const totalHours = shifts.reduce((s, x) => s + x.durationHours, 0);
  const longest = shifts.reduce((a, b) => (b.durationHours > a.durationHours ? b : a));
  const aloneBreachThreshold = 24 - MLC_DAILY_REST_MIN; // 14h
  const dominates =
    longest.durationHours >= aloneBreachThreshold ||
    (totalHours > 0 && longest.durationHours >= totalHours * 0.75);
  if (dominates) {
    return {
      rule: 'daily_rest_10h',
      date,
      cause: 'single_long_shift',
      culprits: [culpritOf(longest)],
    };
  }
  if (n === 2) {
    const gapHours = Math.max(0, shifts[1].startDec - shifts[0].endDec);
    return {
      rule: 'daily_rest_10h',
      date,
      cause: 'two_shifts_too_close',
      gapHours,
      culprits: shifts.map(culpritOf),
    };
  }
  return {
    rule: 'daily_rest_10h',
    date,
    cause: 'piled_up',
    shiftCount: n,
    culprits: shifts.map(culpritOf),
  };
}

function diagnoseWeekly({ date, weekShifts }) {
  const enriched = enrichOnDuty(weekShifts || []);
  const byDay = new Map();
  for (const s of enriched) {
    byDay.set(s.date, (byDay.get(s.date) || 0) + s.durationHours);
  }
  const days = Array.from(byDay.entries())
    .map(([d, h]) => ({ date: d, hours: h }))
    .sort((a, b) => b.hours - a.hours);
  if (days.length === 0) {
    return { rule: 'weekly_rest_77h', date, cause: 'uniform_load', heaviestDay: null };
  }
  const top = days[0];
  const second = days[1] || { hours: 0 };
  const totalHours = days.reduce((s, d) => s + d.hours, 0);
  const avg = totalHours / Math.max(days.length, 1);
  // Spike: top day is well above the average AND clearly above #2.
  const isSpike = top.hours > avg * 1.4 && (days.length === 1 || top.hours > second.hours * 1.25);
  if (isSpike) {
    return {
      rule: 'weekly_rest_77h',
      date,
      cause: 'one_spike_day',
      heaviestDay: { date: top.date, hours: top.hours },
    };
  }
  return {
    rule: 'weekly_rest_77h',
    date,
    cause: 'uniform_load',
    daysWithLoad: days.length,
    avgHours: avg,
  };
}

export function diagnoseBreach({ rule, date, dayShifts, weekShifts }) {
  if (rule === 'daily_rest_10h')  return diagnoseDaily({ date, dayShifts });
  if (rule === 'weekly_rest_77h') return diagnoseWeekly({ date, weekShifts });
  return null; // structural rules — no advisory in v1
}

export function assessApply({
  memberIds = [],
  dates = [],
  proposedRows = [],
  existingWindowShifts = [],
} = {}) {
  if (memberIds.length === 0 || dates.length === 0) {
    return { byMember: {}, hasMlc: false, hasCircadian: false, totalMlcBreaches: 0, totalCircadianFlags: 0 };
  }
  const existing = normalise(existingWindowShifts, 'existing');
  const proposed = normalise(proposedRows, 'proposed');
  const dateSet = new Set(dates);

  const byMember = {};
  let totalMlcBreaches = 0;
  let totalCircadianFlags = 0;

  for (const memberId of memberIds) {
    const existingMine = existing.filter((s) => s.memberId === memberId);
    const proposedMine = proposed.filter((s) => s.memberId === memberId);

    const mlcBreaches = [];
    const seenBreach = new Set();

    for (const date of dates) {
      // Only assess apply dates that actually have a proposed shift for
      // this member — we don't want to surface pre-existing breaches the
      // apply didn't cause.
      const hasProposedToday = proposedMine.some((s) => s.date === date);
      if (!hasProposedToday) continue;

      const winStart = addLocalDays(date, -(CIRCADIAN_WINDOW_DAYS - 1));
      const inWindow = (s) => s.date >= winStart && s.date <= date;

      // Worst-case union: existing + proposed. Skip-vs-overwrite is decided
      // after this check, so the conservative view is the most useful one.
      const weekShifts = [
        ...existingMine.filter(inWindow),
        ...proposedMine.filter(inWindow),
      ];
      const dayShifts = [
        ...existingMine.filter((s) => s.date === date),
        ...proposedMine.filter((s) => s.date === date),
      ];
      const report = assessMlc({ dayShifts, weekShifts });
      for (const b of report.breaches) {
        const key = `${date}|${b.rule}`;
        if (seenBreach.has(key)) continue;
        seenBreach.add(key);
        const diagnosis = diagnoseBreach({
          rule: b.rule,
          date,
          dayShifts,
          weekShifts,
        });
        mlcBreaches.push({
          date,
          rule: b.rule,
          label: b.label,
          projected: b.actual,
          limit: b.limit,
          diagnosis,
        });
      }
    }

    // Circadian — only count swings whose later shift is on an apply date
    // (i.e., a swing the apply introduced or contributed to).
    const allOnDuty = [...existingMine, ...proposedMine]
      .filter((s) => ON_DUTY_TYPES.has(s.shiftType))
      .map((s) => {
        const startDec = hhmmToDecimal(s.startTime);
        let endDec = hhmmToDecimal(s.endTime);
        if (startDec == null || endDec == null) return null;
        if (endDec <= startDec) endDec += 24;
        const [y, m, d] = String(s.date).split('-').map(Number);
        if (!y) return null;
        const dayMs = new Date(y, m - 1, d).getTime();
        const midOfDay = ((startDec + endDec) / 2) % 24;
        return {
          date: s.date,
          startMs: dayMs + startDec * 3_600_000,
          midOfDay,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.startMs - b.startMs);

    const swings = [];
    for (let i = 1; i < allOnDuty.length; i += 1) {
      const a = allOnDuty[i - 1];
      const b = allOnDuty[i];
      const raw = Math.abs(a.midOfDay - b.midOfDay);
      const delta = Math.min(raw, 24 - raw);
      if (delta >= CIRCADIAN_MIDPOINT_DELTA_H) {
        swings.push({ fromDate: a.date, toDate: b.date, deltaHours: delta });
      }
    }

    const circadianFlags = [];
    for (const date of dates) {
      const winStart = addLocalDays(date, -(CIRCADIAN_WINDOW_DAYS - 1));
      const inWin = swings.filter((sw) => sw.toDate >= winStart && sw.toDate <= date);
      if (inWin.length < CIRCADIAN_SWING_THRESHOLD) continue;
      // Only flag if at least one swing's second shift is on an apply date.
      const involvesApply = inWin.some((sw) => dateSet.has(sw.toDate));
      if (!involvesApply) continue;
      circadianFlags.push({
        date,
        count: inWin.length,
        detail: `${inWin.length} schedule swings in past ${CIRCADIAN_WINDOW_DAYS} days (last on ${inWin[inWin.length - 1].toDate})`,
        swings: inWin,
      });
      break; // one flag per member is enough — UI is per-member anyway
    }

    if (mlcBreaches.length > 0 || circadianFlags.length > 0) {
      byMember[memberId] = { mlcBreaches, circadianFlags };
      totalMlcBreaches += mlcBreaches.length;
      totalCircadianFlags += circadianFlags.length;
    }
  }

  return {
    byMember,
    hasMlc: totalMlcBreaches > 0,
    hasCircadian: totalCircadianFlags > 0,
    totalMlcBreaches,
    totalCircadianFlags,
  };
}

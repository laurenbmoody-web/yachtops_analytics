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

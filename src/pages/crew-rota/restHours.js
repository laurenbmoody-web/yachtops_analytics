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

// Canonical regulatory reference line for the formal "Record of Hours of Rest"
// (IMO/ILO joint Guidelines format; MLC Std A2.3 · STCW A-VIII/1). Single source
// shared by BOTH the rota and crew-profile PDF generators so the two exports
// state identical limits. Derived from the constants above.
export const MLC_STANDARD_REF =
  `MLC 2006 Standard A2.3 · STCW Code Section A-VIII/1. Minimum rest: ${MLC_DAILY_REST_MIN}h in any 24h `
  + `and ${MLC_WEEKLY_REST_MIN}h in any 7 days; rest in no more than ${MLC_MAX_REST_PERIODS} periods, one of at least `
  + `${MLC_LONGEST_REST_PERIOD_MIN}h; interval between rest periods not to exceed ${MLC_MAX_WORK_STRETCH}h.`;

// Shorten-lever safety margin (v1.1). The pre-fill computes the maximum
// duration that satisfies all rest rules with this many hours of headroom
// — e.g. with m=1 the daily target becomes 11h rest (10h min + 1h),
// stretch ≤ 13h continuous (14h max − 1h). Tune by editing here.
export const MLC_SHORTEN_SAFETY_MARGIN_H = 1;

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
// Rows where start_time === end_time are dropped: a 00:00→00:00 row (or
// any equal pair) means "unknown / unfixed" in this codebase's history,
// not a deliberate 24h tour. Treating it as 24h was the root cause of
// the legacy 48h-continuous figure on the apply review screen.
function onDutyRanges(dayShifts) {
  return (dayShifts || [])
    .filter(s => ON_DUTY_TYPES.has(s.shiftType))
    .map(s => {
      const start = hhmmToDecimal(s.startTime);
      let end = hhmmToDecimal(s.endTime);
      if (start == null || end == null) return null;
      if (start === end) return null;
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

  // The rest before the first shift (00:00 → …) and after the last (… → 24:00)
  // wrap across midnight into ONE continuous overnight rest — the calendar-day
  // boundary must not count them as two separate periods. Without this merge,
  // any split shift (e.g. 09:00–12:00 + 13:00–17:00) falsely trips the
  // "≤2 periods" rule even though the seafarer's total rest is fine: the
  // leading 9h and trailing 7h are really one 16h overnight block. Only merge
  // when both day edges are rest (no shift sits on the midnight boundary).
  let effPeriods = periods;
  if (periods.length > 1
      && periods[0].start === 0
      && periods[periods.length - 1].end === 24) {
    const lead = periods[0];
    const trail = periods[periods.length - 1];
    const wrapped = {
      start: trail.start,
      end: lead.end + 24,
      length: lead.length + trail.length,
    };
    effPeriods = [wrapped, ...periods.slice(1, -1)];
  }

  const longest = effPeriods.length > 0 ? Math.max(...effPeriods.map(p => p.length)) : 0;
  const periodCount = effPeriods.length;
  const satisfied =
    periodCount <= MLC_MAX_REST_PERIODS && longest >= MLC_LONGEST_REST_PERIOD_MIN;
  return { periods: effPeriods, periodCount, longest, satisfied };
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
    if (startDec === endDec) continue; // see onDutyRanges note
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
      if (start === end) return null; // see onDutyRanges note
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
        if (startDec === endDec) return null; // see onDutyRanges note
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

// ── Shorten-lever pre-fill (v1.1) ──────────────────────────────────────────
// Pure helper. Given a proposed shift that breaches single_long_shift,
// compute the longest safe new duration AND the corresponding new times,
// per direction (trim-from-end vs trim-from-start). The answer depends on
// direction because the chain on the surviving side is different.
//
// Inputs (all camelCase like the rest of restHours):
//   shift       — the proposed row being shortened.
//                 { date, startTime, endTime, shiftType, ... }
//   dayShifts   — every on-duty shift whose shift_date === shift.date.
//                 Caller is responsible for the filter. Includes `shift`
//                 itself; we filter it out internally for O_d.
//   weekShifts  — every on-duty shift in the 7-day rolling window for
//                 this member. Includes `shift`. Used for O_w and the
//                 chain walks (chains span shift_date boundaries via
//                 absolute timeline).
//
// Returns:
//   {
//     end:   { dNewMaxH, viable, newStart, newEnd, bindingRule },
//     start: { dNewMaxH, viable, newStart, newEnd, bindingRule },
//     defaultDirection: 'end' | 'start',
//   }
//
// `bindingRule` ∈ {'daily','weekly','stretch','min_trim','invalid'} —
// which constraint dominated. Metadata for tooling; UI authority is the
// live preview from previewWithEdit.
//
// FORMULAS (with m = MLC_SHORTEN_SAFETY_MARGIN_H, grid = 0.5h):
//
//   d_new_max = min(
//     (24 − MLC_DAILY_REST_MIN) − O_d − m,    // daily budget
//     (7*24 − MLC_WEEKLY_REST_MIN) − O_w − m, // weekly budget
//     MLC_MAX_WORK_STRETCH − C_surviving − m, // stretch on the side that
//                                             // stays touching after trim
//     originalDuration − grid                 // must strictly shorten
//   )
//
//   C_surviving = C_b for end-trim (start side stays touching the
//                                   chain-before), = C_a for start-trim
//                                   (end side stays touching chain-after).
//
// d_new_max is then floor'd to the 0.5h grid. d_new_max ≤ 0 → not viable.
//
// O_d / O_w / C_b / C_a — airtight definitions:
//   * O_d = sum of duration(s) for every on-duty s where s.date ===
//     shift.date, excluding `shift` itself. Matches the existing
//     restForDay(dayShifts) model — shifts on adjacent dates whose
//     absolute time bleeds across midnight are NOT in O_d. Consistency
//     with assessMlc matters more than theoretical purity here.
//   * O_w = same, over weekShifts.
//   * C_b = chain leading INTO shift's start in the absolute timeline.
//     Convert each on-duty shift in weekShifts (excluding `shift`) to
//     {startMs, endMs}. Walking from cursor = shift.startMs, repeatedly
//     find the touching predecessor (endMs === cursor), add its duration
//     to C_b, set cursor = its startMs. Stop when no touching shift.
//     Pick longest chain back by tie-breaking on earliest startMs.
//   * C_a = symmetric forward walk from shift.endMs.
//
// O_d and C_b can diverge: a shift on shift_date d−1 that ends at 06:00
// day d touches shift S starting at 06:00 day d (counts in C_b) but does
// NOT add to O_d for day d (its shift_date is d−1).
//
// OVERNIGHT CAVEAT: for shifts where e0 > 24 (overnight), trim-from-start
// can push newStart past midnight into day d+1. The data model lacks a
// way to represent "shift_date d, but starts on d+1" — and the start_time
// would be misinterpreted as early-morning of d. v1.1 caps start-trim to
// keep newStart < 24:00 for overnight shifts; if the formal d_new_max
// would require past-midnight start, start-trim is marked non-viable.

function shiftDecRange(s) {
  if (!s || !ON_DUTY_TYPES.has(s.shiftType)) return null;
  const start = hhmmToDecimal(s.startTime);
  let end = hhmmToDecimal(s.endTime);
  if (start == null || end == null) return null;
  if (start === end) return null;
  if (end <= start) end += 24;
  return { start, end, duration: end - start };
}

function shiftAbsMs(s) {
  const r = shiftDecRange(s);
  if (!r) return null;
  const [y, m, d] = String(s.date).split('-').map(Number);
  if (!y || !m || !d) return null;
  const dayMs = new Date(y, m - 1, d).getTime();
  return {
    startMs: dayMs + r.start * 3_600_000,
    endMs:   dayMs + r.end   * 3_600_000,
    duration: r.duration,
  };
}

function decToHHMM(dec) {
  // Normalise into [0, 24) and round to the nearest minute to avoid
  // floating-point display drift (e.g. 12.4999999 → "12:30" not "12:29").
  const normalised = ((dec % 24) + 24) % 24;
  const totalMin = Math.round(normalised * 60);
  const h = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function isSameShift(a, b) {
  if (a === b) return true;
  return (
    a.date === b.date
    && a.startTime === b.startTime
    && a.endTime   === b.endTime
    && a.shiftType === b.shiftType
    && (a.subType ?? null) === (b.subType ?? null)
  );
}

function chainBefore(cursorMs, otherIntervals) {
  let total = 0;
  let cur = cursorMs;
  const seen = new Set();
  // Defensive cycle-guard: bound the walk at the number of intervals.
  for (let i = 0; i <= otherIntervals.length; i += 1) {
    const touching = otherIntervals
      .filter((iv) => iv.endMs === cur && !seen.has(iv.startMs))
      .sort((a, b) => a.startMs - b.startMs); // earliest start = longest chain back
    if (touching.length === 0) break;
    const next = touching[0];
    seen.add(next.startMs);
    total += next.duration;
    cur = next.startMs;
  }
  return total;
}

function chainAfter(cursorMs, otherIntervals) {
  let total = 0;
  let cur = cursorMs;
  const seen = new Set();
  for (let i = 0; i <= otherIntervals.length; i += 1) {
    const touching = otherIntervals
      .filter((iv) => iv.startMs === cur && !seen.has(iv.endMs))
      .sort((a, b) => b.endMs - a.endMs); // latest end = longest chain forward
    if (touching.length === 0) break;
    const next = touching[0];
    seen.add(next.endMs);
    total += next.duration;
    cur = next.endMs;
  }
  return total;
}

export function computeShortenPrefill({
  shift,
  dayShifts = [],
  weekShifts = [],
} = {}) {
  const sRange = shiftDecRange(shift);
  const sAbs = shiftAbsMs(shift);
  if (!sRange || !sAbs) {
    const fallback = {
      dNewMaxH: 0,
      viable: false,
      newStart: shift?.startTime ?? null,
      newEnd:   shift?.endTime   ?? null,
      bindingRule: 'invalid',
    };
    return { end: fallback, start: fallback, defaultDirection: 'end' };
  }
  const m = MLC_SHORTEN_SAFETY_MARGIN_H;
  const grid = 0.5;
  const s0 = sRange.start;
  const e0 = sRange.end;
  const originalDuration = sRange.duration;

  // O_d / O_w — exclude `shift` itself.
  const otherDay = dayShifts.filter((s) => !isSameShift(s, shift));
  const O_d = otherDay.reduce((sum, s) => {
    const r = shiftDecRange(s);
    return sum + (r ? r.duration : 0);
  }, 0);
  const otherWeek = weekShifts.filter((s) => !isSameShift(s, shift));
  const O_w = otherWeek.reduce((sum, s) => {
    const r = shiftDecRange(s);
    return sum + (r ? r.duration : 0);
  }, 0);

  // Chains — absolute-ms walks, restricted to other on-duty intervals in
  // the week window.
  const otherIntervals = otherWeek.map(shiftAbsMs).filter(Boolean);
  const C_b = chainBefore(sAbs.startMs, otherIntervals);
  const C_a = chainAfter(sAbs.endMs, otherIntervals);

  const dailyBudget   = 24 - MLC_DAILY_REST_MIN;        // 14
  const weeklyBudget  = 7 * 24 - MLC_WEEKLY_REST_MIN;   // 91
  const stretchBudget = MLC_MAX_WORK_STRETCH;            // 14
  const dailyCap   = dailyBudget   - O_d - m;
  const weeklyCap  = weeklyBudget  - O_w - m;
  const stretchCapEnd   = stretchBudget - C_b - m;
  const stretchCapStart = stretchBudget - C_a - m;
  const minTrimCap = originalDuration - grid; // must strictly shorten

  const pickBinding = (daily, weekly, stretch, minTrim) => {
    const values = [
      { rule: 'daily',    value: daily },
      { rule: 'weekly',   value: weekly },
      { rule: 'stretch',  value: stretch },
      { rule: 'min_trim', value: minTrim },
    ];
    return values.reduce((a, b) => (b.value < a.value ? b : a)).rule;
  };
  const floorToGrid = (x) => Math.floor(x / grid) * grid;

  const endRaw   = Math.min(dailyCap, weeklyCap, stretchCapEnd,   minTrimCap);
  const startRaw = Math.min(dailyCap, weeklyCap, stretchCapStart, minTrimCap);
  const endBinding   = pickBinding(dailyCap, weeklyCap, stretchCapEnd,   minTrimCap);
  const startBinding = pickBinding(dailyCap, weeklyCap, stretchCapStart, minTrimCap);

  // Overnight cap on start-trim: for shifts with e0 > 24 (overnight),
  // newStart = e0 − d_new must stay < 24 so it lands on shift.date, not
  // the next day. d_new > (e0 − 24).
  let startCapByOvernight = startRaw;
  if (e0 > 24) {
    // Smallest grid-aligned d_new keeping newStart strictly < 24:
    //   d_new > (e0 − 24) → d_new ≥ ceil((e0 − 24 + ε) / grid) * grid
    const lower = Math.ceil(((e0 - 24) + 1e-9) / grid) * grid;
    if (startRaw < lower) startCapByOvernight = 0; // not viable
  }

  const endDNewMax   = endRaw > 0 ? floorToGrid(endRaw) : 0;
  const startDNewMax = startCapByOvernight > 0 ? floorToGrid(startCapByOvernight) : 0;

  const end = endDNewMax > 0
    ? {
        dNewMaxH: endDNewMax,
        viable: true,
        newStart: shift.startTime,
        newEnd: decToHHMM(s0 + endDNewMax),
        bindingRule: endBinding,
      }
    : {
        dNewMaxH: 0,
        viable: false,
        newStart: shift.startTime,
        newEnd: shift.endTime,
        bindingRule: endBinding,
      };

  const start = startDNewMax > 0
    ? {
        dNewMaxH: startDNewMax,
        viable: true,
        newStart: decToHHMM(e0 - startDNewMax),
        newEnd: shift.endTime,
        bindingRule: startBinding,
      }
    : {
        dNewMaxH: 0,
        viable: false,
        newStart: shift.startTime,
        newEnd: shift.endTime,
        bindingRule: e0 > 24 && startRaw > 0 ? 'overnight_boundary' : startBinding,
      };

  // Tie → end (intuitive default; chief usually wants to end earlier).
  const defaultDirection = endDNewMax >= startDNewMax ? 'end' : 'start';

  return { end, start, defaultDirection };
}

// ── Bulk shorten pre-fill (v1.2) ───────────────────────────────────────────
// For a RECURRING single_long_shift breach (same too-long shift on N days
// in a row), compute ONE conservative trim that clears every viable day.
// Trimming is monotonically rest-positive (see v1.2 discovery Q1) so a
// single short-enough length never INDUCES a breach — but the per-day
// chain context can make a given direction non-viable on some days. In
// those cases the bulk picks the direction maximising viable-day count
// and surfaces the rest as excluded.
//
// Direction algorithm (spec settlement (a)):
//   1. Primary sort      → more viable days wins.
//   2. First tiebreak    → larger bulkDNewMax wins.
//   3. Ultimate tiebreak → 'end' (intuitive default).
//
// Inputs:
//   perDay: Array<{ shift, dayShifts, weekShifts, row? }>
//     One entry per breaching day. `shift`/`dayShifts`/`weekShifts` match
//     computeShortenPrefill's contract. `row` is passed through to the
//     output unchanged — caller can attach the snake_case row for later
//     use (key derivation, etc.).
//
// Returns:
//   {
//     direction: 'end' | 'start',
//     bulkDNewMaxH: number,            // 0 when no viable days
//     bulkNewStart: 'HH:MM' | null,    // representative summary (uniform
//     bulkNewEnd:   'HH:MM' | null,    //   recurring shifts → same value
//                                      //   for every day; varying shifts
//                                      //   → use the first viable day)
//     perDay: [
//       {
//         date, row?,                  // row passed through if supplied
//         viableInBulkDirection: bool,
//         viableInOtherDirection: bool, // honesty hook for C3 copy
//         newStart: 'HH:MM' | null,    // null when not viable in bulk dir
//         newEnd:   'HH:MM' | null,
//         bindingRule: same enum as computeShortenPrefill,
//       },
//       …
//     ],
//     includedCount: number,           // perDay where viableInBulkDirection
//     excludedCount: number,
//   }

export function computeBulkShortenPrefill({ perDay = [], directionOverride } = {}) {
  if (!Array.isArray(perDay) || perDay.length === 0) {
    return {
      direction: 'end',
      bulkDNewMaxH: 0,
      bulkNewStart: null,
      bulkNewEnd: null,
      perDay: [],
      includedCount: 0,
      excludedCount: 0,
    };
  }

  // Per-day v1.1 prefill (both directions).
  const dayPrefills = perDay.map((d) => ({
    ...d,
    prefill: computeShortenPrefill(d),
  }));

  const analyse = (dir) => {
    const viable = dayPrefills.filter((d) => d.prefill[dir].viable);
    const bulkDNewMax = viable.length > 0
      ? Math.min(...viable.map((d) => d.prefill[dir].dNewMaxH))
      : 0;
    return { viableCount: viable.length, bulkDNewMax };
  };
  const endA = analyse('end');
  const startA = analyse('start');

  // Direction algorithm (a): viableCount primary, bulkDNewMax tiebreak,
  // end ultimate tiebreak. directionOverride bypasses the algorithm when
  // the caller wants a specific direction (e.g. UI's direction-switch).
  let direction;
  if (directionOverride === 'end' || directionOverride === 'start') {
    direction = directionOverride;
  } else if (endA.viableCount > startA.viableCount) direction = 'end';
  else if (startA.viableCount > endA.viableCount) direction = 'start';
  else if (endA.bulkDNewMax >= startA.bulkDNewMax) direction = 'end';
  else direction = 'start';

  const otherDir = direction === 'end' ? 'start' : 'end';
  const chosen = direction === 'end' ? endA : startA;
  const bulkDNewMaxH = chosen.bulkDNewMax;

  // Bulk binding rule — the constraint that bound the bulk minimum. The
  // day whose dNewMaxH equals bulkDNewMaxH is the binding day; take its
  // per-day bindingRule. Used by the readout to explain WHY the bulk
  // trims harder than the daily rule alone would imply (weekly cap on
  // later days, chain caps, etc.).
  let bulkBindingRule = null;
  if (bulkDNewMaxH > 0) {
    const bindingDay = dayPrefills.find(
      (d) => d.prefill[direction].viable && d.prefill[direction].dNewMaxH === bulkDNewMaxH,
    );
    if (bindingDay) bulkBindingRule = bindingDay.prefill[direction].bindingRule;
  }

  // Representative bulk new times — derived from any viable day's shift
  // (uniform recurring → all days yield identical values; varying shifts
  // → first viable day is the chosen representative, with per-day values
  // below carrying the true per-day truth).
  let bulkNewStart = null;
  let bulkNewEnd = null;
  if (bulkDNewMaxH > 0) {
    const firstViable = dayPrefills.find((d) => d.prefill[direction].viable);
    if (firstViable) {
      const sRange = shiftDecRange(firstViable.shift);
      if (sRange) {
        if (direction === 'end') {
          bulkNewStart = firstViable.shift.startTime;
          bulkNewEnd = decToHHMM(sRange.start + bulkDNewMaxH);
        } else {
          bulkNewStart = decToHHMM(sRange.end - bulkDNewMaxH);
          bulkNewEnd = firstViable.shift.endTime;
        }
      }
    }
  }

  const perDayOut = dayPrefills.map((d) => {
    const viableInBulkDirection = d.prefill[direction].viable;
    const viableInOtherDirection = d.prefill[otherDir].viable;
    const bindingRule = d.prefill[direction].bindingRule;
    let newStart = null;
    let newEnd = null;
    if (viableInBulkDirection && bulkDNewMaxH > 0) {
      const sRange = shiftDecRange(d.shift);
      if (sRange) {
        if (direction === 'end') {
          newStart = d.shift.startTime;
          newEnd = decToHHMM(sRange.start + bulkDNewMaxH);
        } else {
          newStart = decToHHMM(sRange.end - bulkDNewMaxH);
          newEnd = d.shift.endTime;
        }
      }
    }
    return {
      date: d.shift.date,
      row: d.row,
      viableInBulkDirection,
      viableInOtherDirection,
      newStart,
      newEnd,
      bindingRule,
    };
  });

  return {
    direction,
    bulkDNewMaxH,
    bulkBindingRule,
    bulkNewStart,
    bulkNewEnd,
    perDay: perDayOut,
    includedCount: chosen.viableCount,
    excludedCount: dayPrefills.length - chosen.viableCount,
  };
}

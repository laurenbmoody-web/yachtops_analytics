// coverageEngine — deterministic logic for re-assigning the hours a rest
// suggestion frees up to other crew who can absorb them without breaching MLC.
//
// Pure + framework-free so it can be unit-reasoned and reused. The UI
// (CoverageApplyModal) handles state; this module only computes:
//   · each candidate's rest HEADROOM (how many on-duty hours they can take),
//   · a sensible default spread of the freed hours across candidates,
//   · the time sub-ranges for each recipient's covering shift, and
//   · the rota_shifts rows + delete-ids to hand to applyTemplate.
//
// Headroom uses the two hour-based MLC limits, which are exact under adding
// on-duty time (every on-duty hour reduces rest 1:1): daily ≥10h/24h and
// weekly ≥77h/7d. Structural rules (split / 14h stretch) are left to the
// preview's note rather than the auto-spread.

import { MLC_DAILY_REST_MIN, MLC_WEEKLY_REST_MIN, ON_DUTY_TYPES, assessMlc } from './restHours';

// Add n days to a 'YYYY-MM-DD' string via local date components.
function addDaysStr(dateStr, n) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

const toDec = (hhmm) => {
  const [h, m] = String(hhmm || '').slice(0, 5).split(':').map(Number);
  if (Number.isNaN(h)) return null;
  return h + (m || 0) / 60;
};
const toHHMM = (dec) => {
  const d = ((dec % 24) + 24) % 24;
  const h = Math.floor(d);
  const m = Math.round((d - h) * 60);
  // carry minute rounding into the hour
  const hh = m === 60 ? (h + 1) % 24 : h;
  const mm = m === 60 ? 0 : m;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};
export const blockHours = (start, end) => {
  const s = toDec(start); const e = toDec(end);
  if (s == null || e == null) return 0;
  let d = e - s;
  if (d <= 0) d += 24; // overnight
  return d;
};

// Two time ranges overlap (decimal hours, with overnight wrap normalised).
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  if (aStart == null || bStart == null) return false;
  const aE = aEnd <= aStart ? aEnd + 24 : aEnd;
  const bE = bEnd <= bStart ? bEnd + 24 : bEnd;
  return aStart < bE && bStart < aE;
}

// Is a member genuinely FREE across [start,end] on `date` — i.e. has NO on-duty
// block overlapping that window? Coverage only makes sense if the recipient is
// resting then; someone already on duty during the block can't add a body, so
// reassigning to them just leaves the position unstaffed. `windowShifts` is the
// camelCase shift list for the loaded window.
export function isFreeDuring({ memberId, date, start, end, windowShifts }) {
  const s = toDec(start); const e = toDec(end);
  return !(windowShifts || []).some((sh) => sh.memberId === memberId
    && sh.date === date
    && ON_DUTY_TYPES.has(sh.shiftType)
    && rangesOverlap(s, e, toDec(sh.startTime), toDec(sh.endTime)));
}

// A member's ON-DUTY intervals that overlap the window [S,E] (decimal hours,
// E may exceed 24 for an overnight window). Each block is tested at −24/0/+24h
// offsets so both same-day blocks that straddle the window edge and midnight
// wrap are caught — without ever mistaking a block starting before the window
// for a free slot. Returns intervals clamped to [S,E], sorted by start.
function busyIntervals(memberId, date, windowShifts, S, E, EPS = 1e-6) {
  const busy = [];
  for (const sh of (windowShifts || [])) {
    if (sh.memberId !== memberId || sh.date !== date || !ON_DUTY_TYPES.has(sh.shiftType)) continue;
    const bS = toDec(sh.startTime); let bE = toDec(sh.endTime);
    if (bS == null || bE == null) continue;
    if (bE <= bS) bE += 24; // overnight block on the linear axis
    for (const off of [-24, 0, 24]) {
      const lo = Math.max(S, bS + off); const hi = Math.min(E, bE + off);
      if (hi > lo + EPS) busy.push([lo, hi]);
    }
  }
  return busy.sort((a, b) => a[0] - b[0]);
}

// How many hours a member is FREE inside [start,end] on `date` (window minus
// any on-duty overlap). The cap on how much of the block they could cover.
export function freeHoursInWindow({ memberId, date, start, end, windowShifts }) {
  const S = toDec(start); const dur = blockHours(start, end);
  if (S == null || !(dur > 0)) return 0;
  const E = S + dur;
  let used = 0; let cur = S;
  for (const [lo, hi] of busyIntervals(memberId, date, windowShifts, S, E)) {
    const a = Math.max(lo, cur); if (hi > a) { used += hi - a; cur = hi; }
  }
  return Math.max(0, Math.round((dur - used) * 100) / 100);
}

// One candidate's spare capacity on the breach date.
export function candidateHeadroom(member) {
  const dailyRoom = (member.rest24hDecimal ?? 24) - MLC_DAILY_REST_MIN;
  const weeklyRoom = (member.pastWeekHours ?? 168) - MLC_WEEKLY_REST_MIN;
  const headroom = Math.max(0, Math.min(dailyRoom, weeklyRoom));
  return { dailyRoom, weeklyRoom, headroom };
}

// Full MLC re-assessment for a recipient AFTER taking a covering block — all
// four rules (daily 10h, weekly 77h, rest split, 14h stretch), so coverage
// never silently moves a structural breach onto someone else. `block` is the
// carved slice { start, end } in HH:MM; `windowShifts` is every member's
// camelCase shifts for the loaded window.
export function assessRecipient({ memberId, windowShifts, date, block }) {
  const weekStart = addDaysStr(date, -6);
  const week = (windowShifts || []).filter(
    (s) => s.memberId === memberId && s.date >= weekStart && s.date <= date,
  );
  const day = week.filter((s) => s.date === date);
  const add = block && block.hours > 0
    ? [{ date, startTime: block.start, endTime: block.end, shiftType: block.shiftType || 'watch' }]
    : [];
  const rep = assessMlc({ dayShifts: [...day, ...add], weekShifts: [...week, ...add] });
  const splitBreach = rep.breaches.some((b) => b.rule === 'rest_period_split');
  const stretchBreach = rep.breaches.some((b) => b.rule === 'max_work_stretch_14h');
  return {
    rest24: rep.rest24h,
    week: rep.pastWeekHours,
    dailyOk: rep.rest24h >= MLC_DAILY_REST_MIN,
    weeklyOk: rep.pastWeekHours >= MLC_WEEKLY_REST_MIN,
    splitBreach,
    stretchBreach,
    structuralNote: stretchBreach ? 'over 14h continuous' : splitBreach ? 'splits rest > 2 periods' : null,
    anyBreach: rep.anyBreach,
  };
}

// Same-department crew, ranked by headroom desc. Excludes the breaching member,
// anyone rostered fully off that day (so coverage never cancels a day off), and
// anyone already in any MLC breach (don't pile onto someone non-compliant).
export function buildCandidates({ sourceMember, crew }) {
  if (!sourceMember) return [];
  return (crew || [])
    .filter((c) => c.id !== sourceMember.id
      && c.department === sourceMember.department
      && !c.offToday
      && !c.mlcWarning)
    .map((c) => ({
      id: c.id,
      name: c.name,
      initials: c.initials,
      role: c.role,
      departmentId: c.departmentId,
      rest24hDecimal: c.rest24hDecimal,
      pastWeekHours: c.pastWeekHours,
      ...candidateHeadroom(c),
    }))
    .filter((c) => c.headroom >= 1)
    .sort((a, b) => b.headroom - a.headroom);
}

// Greedy INTERVAL coverage: split the freed window across whoever is FREE for
// each part, packing as few crew as possible while respecting each one's rest
// headroom (the hours they can take). Several crew can make up one block, and
// any stretch nobody is free for comes back as a GAP — never silently dumped on
// someone already on duty. `caps` optionally limits hours per member id
// (defaults to floored headroom; 0 excludes a member). Works on a linear axis
// anchored at the block start so a window running past midnight is handled.
// Returns { slices: [{ id|null, gap, start, end, hours }], gapHours }.
export function planCoverage({ freed, candidates, date, windowShifts, caps = null }) {
  const EPS = 1e-6;
  const S = toDec(freed?.start);
  if (S == null || !(freed.hours > 0) || !candidates?.length) {
    return { slices: freed?.hours > 0 ? [{ id: null, gap: true, start: freed.start, end: freed.end, hours: freed.hours }] : [], gapHours: freed?.hours || 0 };
  }
  const E = S + freed.hours;

  // Each candidate's FREE sub-intervals within [S,E] (window minus on-duty).
  const freeById = new Map();
  for (const c of candidates) {
    const busy = busyIntervals(c.id, date, windowShifts, S, E, EPS);
    const free = []; let cur = S;
    for (const [lo, hi] of busy) {
      if (lo > cur + EPS) free.push([cur, lo]);
      cur = Math.max(cur, hi);
    }
    if (E > cur + EPS) free.push([cur, E]);
    freeById.set(c.id, free);
  }

  const capLeft = new Map(candidates.map((c) => [c.id,
    Math.max(0, caps && caps[c.id] != null ? caps[c.id] : Math.floor(c.headroom))]));

  const out = [];
  let cursor = S;
  while (cursor < E - EPS) {
    let best = null; let bestReach = cursor;
    for (const c of candidates) {
      if (capLeft.get(c.id) <= EPS) continue;
      const iv = (freeById.get(c.id) || []).find(([a, b]) => a <= cursor + EPS && b > cursor + EPS);
      if (!iv) continue;
      const reach = Math.min(iv[1], cursor + capLeft.get(c.id), E);
      if (reach > bestReach + EPS) { bestReach = reach; best = c; }
    }
    if (!best) {
      // Nobody free here → gap. Jump to the next time someone frees up.
      let next = E;
      for (const c of candidates) {
        if (capLeft.get(c.id) <= EPS) continue;
        for (const [a] of (freeById.get(c.id) || [])) if (a > cursor + EPS && a < next) next = a;
      }
      out.push({ id: null, gap: true, start: cursor, end: next });
      cursor = next;
      continue;
    }
    out.push({ id: best.id, gap: false, start: cursor, end: bestReach });
    capLeft.set(best.id, capLeft.get(best.id) - (bestReach - cursor));
    cursor = bestReach;
  }

  // Merge adjacent same-owner runs, then format to HH:MM.
  const merged = [];
  for (const s of out) {
    const prev = merged[merged.length - 1];
    if (prev && prev.id === s.id && Math.abs(prev.end - s.start) < EPS) prev.end = s.end;
    else merged.push({ ...s });
  }
  const round2 = (n) => Math.round(n * 100) / 100;
  const slices = merged.map((s) => ({
    id: s.id, gap: !!s.gap, start: toHHMM(s.start), end: toHHMM(s.end), hours: round2(s.end - s.start),
  }));
  return { slices, gapHours: round2(slices.filter((s) => s.gap).reduce((a, s) => a + s.hours, 0)) };
}

// Projected rest for a recipient after taking `addHours` of on-duty cover.
// Exact for the two hour-based MLC limits.
export function recipientAfter(member, addHours) {
  const rest24 = (member.rest24hDecimal ?? 24) - addHours;
  const week = (member.pastWeekHours ?? 168) - addHours;
  return {
    rest24,
    week,
    dailyOk: rest24 >= MLC_DAILY_REST_MIN,
    weeklyOk: week >= MLC_WEEKLY_REST_MIN,
  };
}

// Build the applyTemplate payload: delete the source block, then insert each
// recipient's covering slice. Any portion the source keeps — a shorten's
// trimmed-down block, plus any coverage GAP nobody was free for — is re-inserted
// onto the source, so we never leave a watch position silently unstaffed.
export function buildApplyPlan({ base, freed, slices, sourceKeep = [] }) {
  const rows = [];
  const deleteIds = [];
  const mk = (memberId, start, end, shiftType, subType) => {
    const row = {
      tenant_id: base.tenantId,
      rota_id: base.rotaId,
      member_id: memberId,
      shift_date: freed.date,
      start_time: start.length === 5 ? `${start}:00` : start,
      end_time: end.length === 5 ? `${end}:00` : end,
      shift_type: shiftType || 'watch',
      sub_type: subType ?? null,
      // Publish-capable tiers (COMMAND / CHIEF) write live; otherwise draft.
      status: base.status === 'published' ? 'published' : 'draft',
    };
    if (base.tripId) row.trip_id = base.tripId;
    if (base.createdBy) row.created_by = base.createdBy;
    return row;
  };

  if (freed.sourceShiftId) deleteIds.push(freed.sourceShiftId);
  // Portions the SOURCE retains: a shorten's kept block + any uncovered gaps.
  const keep = [];
  if (freed.action === 'shorten' && freed.keep) keep.push(freed.keep);
  for (const g of (sourceKeep || [])) if (g && g.start && g.end) keep.push(g);
  for (const k of keep) {
    rows.push(mk(base.sourceMemberId, k.start, k.end, freed.sourceShiftType, freed.sourceSubType));
  }
  // Recipients absorb their covered slices, inheriting the block's type/sub-type.
  for (const s of slices) {
    if (!s.id) continue;
    rows.push(mk(s.id, s.start, s.end, freed.sourceShiftType, freed.sourceSubType));
  }
  return { rows, deleteIds };
}

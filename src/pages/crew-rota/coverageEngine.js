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

import { MLC_DAILY_REST_MIN, MLC_WEEKLY_REST_MIN, assessMlc } from './restHours';

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

// Spread the freed hours as FEW, LARGE chunks as possible: fill the
// highest-headroom candidate to capacity, then spill to the next, and so on.
// A 4h watch goes to one person who can take it — not sliced into 1h slivers
// across four people (`candidates` is pre-sorted by headroom desc). The chief
// can still re-balance manually in the modal. Returns { alloc, unassigned }.
export function defaultSpread(candidates, freedHours) {
  let remaining = Math.round(freedHours || 0);
  const alloc = {};
  for (const c of candidates) {
    if (remaining <= 0) break;
    const cap = Math.floor(c.headroom);
    if (cap <= 0) continue;
    const take = Math.min(cap, remaining);
    alloc[c.id] = take;
    remaining -= take;
  }
  return { alloc, unassigned: remaining };
}

// Carve the freed block into sequential sub-ranges per allocation, in the
// given order. e.g. freed 12:00–16:00 with [{2h},{2h}] → 12:00–14:00, 14:00–16:00.
export function sliceFreed(freed, orderedAllocs) {
  let cursor = toDec(freed.start);
  return orderedAllocs
    .filter((a) => a.hours > 0)
    .map((a) => {
      const start = toHHMM(cursor);
      cursor += a.hours;
      return { ...a, start, end: toHHMM(cursor) };
    });
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

// Build the applyTemplate payload: delete the source block (and re-insert the
// kept portion for a shorten), then insert each recipient's covering shift.
export function buildApplyPlan({ base, freed, slices }) {
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
  // Shorten: the source keeps the trimmed-down block.
  if (freed.action === 'shorten' && freed.keep) {
    rows.push(mk(base.sourceMemberId, freed.keep.start, freed.keep.end,
      freed.sourceShiftType, freed.sourceSubType));
  }
  // Recipients absorb the freed hours, inheriting the block's type/sub-type.
  for (const s of slices) {
    rows.push(mk(s.id, s.start, s.end, freed.sourceShiftType, freed.sourceSubType));
  }
  return { rows, deleteIds };
}

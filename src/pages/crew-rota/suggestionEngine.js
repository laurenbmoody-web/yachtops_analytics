// suggestionEngine — DETERMINISTIC generation + ranking of MLC rest fixes for
// one breaching crew member. Same rota in → same top-N out, every time. The
// LLM is no longer the decision-maker; it only writes copy for the changes
// this engine picks (see useRotaRestData).
//
// For each realistic lever (remove a block, shorten it, give a future day off)
// we compute: how much rolling-7 rest it restores for THIS crew, whether it
// clears the breach, and whether same-department crew can absorb the freed
// hours without breaching themselves. The score BALANCES rest-restored against
// coverage safety (per product decision), with stable tie-breaks.

import {
  assessMlc, ON_DUTY_TYPES, MLC_WEEKLY_REST_MIN, MLC_DAILY_REST_MIN,
} from './restHours';
import {
  blockHours, buildCandidates, defaultSpread, sliceFreed, assessRecipient,
} from './coverageEngine';

const addDays = (dateStr, n) => {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
};
const toCamel = (s) => ({
  date: s.shift_date, startTime: s.start_time, endTime: s.end_time, shiftType: s.shift_type,
});

// Apply a structured change to a set of DB-shape rows (mirrors the panel's
// applyChange) — used only for projecting the rest gain.
function applyChange(rows, change) {
  if (!change || !change.shift_date) return rows;
  const targetHH = (change.original_start || '').slice(0, 5);
  const out = [];
  for (const r of rows) {
    const isTarget = r.shift_date === change.shift_date
      && ON_DUTY_TYPES.has(r.shift_type)
      && (r.start_time || '').slice(0, 5) === targetHH;
    if (!isTarget) { out.push(r); continue; }
    if (change.action === 'remove') continue; // drop it
    out.push({ ...r, start_time: change.new_start || r.start_time, end_time: change.new_end || r.end_time });
  }
  return out;
}

// Forward-looking rolling-7 rest after the change, anchored on the change's own
// date (future levers only pay off the day they land).
function projectWeekly(change, allRows, effDate) {
  const evalDate = change.shift_date > effDate ? change.shift_date : effDate;
  const winStart = addDays(evalDate, -6);
  const win = (allRows || []).filter(s => s.shift_date >= winStart && s.shift_date <= evalDate);
  return assessMlc({ dayShifts: [], weekShifts: applyChange(win, change).map(toCamel) }).pastWeekHours;
}

// Resolve the freed block for a change against the real rows.
function freedFor(change, allRows) {
  const hh = (change.original_start || '').slice(0, 5);
  const src = (allRows || []).find(r => r.shift_date === change.shift_date
    && ON_DUTY_TYPES.has(r.shift_type) && (r.start_time || '').slice(0, 5) === hh);
  if (!src) return null;
  const sStart = (src.start_time || '').slice(0, 5);
  const sEnd = (src.end_time || '').slice(0, 5);
  const base = {
    date: change.shift_date,
    sourceShiftId: src.id,
    sourceShiftType: src.shift_type,
    sourceSubType: src.sub_type ?? null,
  };
  if (change.action !== 'shorten') {
    return { ...base, action: 'remove', start: sStart, end: sEnd, hours: blockHours(sStart, sEnd) };
  }
  const kStart = (change.new_start || sStart).slice(0, 5);
  const kEnd = (change.new_end || sEnd).slice(0, 5);
  const freedStart = kStart === sStart ? kEnd : sStart;
  const freedEnd = kStart === sStart ? sEnd : kStart;
  return {
    ...base, action: 'shorten', keep: { start: kStart, end: kEnd },
    start: freedStart, end: freedEnd, hours: blockHours(freedStart, freedEnd),
  };
}

// Can same-dept crew absorb the freed hours without any of them breaching?
function evaluateCoverage({ sourceMember, freed, roster, windowShifts }) {
  const cands = buildCandidates({ sourceMember, crew: roster || [] });
  if (cands.length === 0 || !freed) return { ok: false, partial: false, crewCount: 0, unassigned: freed?.hours || 0, roles: [] };
  const { alloc, unassigned } = defaultSpread(cands, freed.hours);
  const ordered = cands.map(c => ({ id: c.id, hours: alloc[c.id] || 0 })).filter(a => a.hours > 0);
  const slices = sliceFreed(freed, ordered);
  const breach = slices.some(s => assessRecipient({
    memberId: s.id, windowShifts, date: freed.date,
    block: { ...s, shiftType: freed.sourceShiftType },
  }).anyBreach);
  return {
    ok: unassigned === 0 && !breach && slices.length > 0,
    partial: slices.length > 0 && !breach,
    crewCount: slices.length,
    unassigned,
    roles: slices.map(s => (roster.find(r => r.id === s.id) || {}).role).filter(Boolean),
  };
}

const dayLabel = (dateStr, effDate) => {
  if (dateStr === effDate) return 'today';
  if (dateStr === addDays(effDate, 1)) return 'tomorrow';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long' });
};

// Main entry. Returns up to `limit` ranked, fully-costed suggestions.
export function generateRankedSuggestions({
  sourceMember, effDate, allRows, report, roster, windowShifts, limit = 2,
}) {
  if (!sourceMember || !report) return [];
  const restFrom = report.pastWeekHours;
  const dailyBelow = report.rest24h < MLC_DAILY_REST_MIN;
  const weeklyDeficit = Math.max(0, MLC_WEEKLY_REST_MIN - restFrom);

  const raw = [];
  const pushChange = (kind, change) => {
    const freed = freedFor(change, allRows);
    if (!freed || freed.hours <= 0) return;
    raw.push({ kind, change, freed });
  };

  // Levers on today's on-duty blocks: remove, and (for longer blocks) shorten.
  const todayBlocks = (allRows || [])
    .filter(r => r.shift_date === effDate && ON_DUTY_TYPES.has(r.shift_type))
    .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
  for (const b of todayBlocks) {
    const start = (b.start_time || '').slice(0, 5);
    const hrs = blockHours(b.start_time, b.end_time);
    pushChange('remove', { shift_date: effDate, original_start: start, action: 'remove' });
    if (hrs >= 3) {
      // Trim the tail by enough to dent the deficit, but keep ≥1h of the block.
      const trim = Math.min(hrs - 1, Math.max(2, Math.ceil(weeklyDeficit) || 2));
      const keepEnd = addHHMM(start, hrs - trim);
      pushChange('shorten', { shift_date: effDate, original_start: start, action: 'shorten', new_start: start, new_end: keepEnd });
    }
  }

  // One "day off" lever: the soonest upcoming day that currently has duty.
  for (let i = 1; i <= 6; i += 1) {
    const d = addDays(effDate, i);
    const blocks = (allRows || []).filter(r => r.shift_date === d && ON_DUTY_TYPES.has(r.shift_type));
    if (blocks.length) {
      const big = blocks.reduce((a, c) => (blockHours(c.start_time, c.end_time) > blockHours(a.start_time, a.end_time) ? c : a));
      pushChange('day_off', { shift_date: d, original_start: (big.start_time || '').slice(0, 5), action: 'remove' });
      break;
    }
  }

  // Score + de-dupe by freed signature. Each candidate is scored defensively
  // so one bad row (odd times, missing shifts) can't empty the whole list.
  const seen = new Set();
  const scored = [];
  for (const r of raw) {
    const sig = `${r.freed.date}|${r.freed.start}|${r.freed.end}|${r.change.action}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    try {
      const restTo = projectWeekly(r.change, allRows, effDate);
      const closed = weeklyDeficit > 0 ? Math.min(restTo - restFrom, weeklyDeficit) / weeklyDeficit : 1;
      const resolvesWeekly = restTo >= MLC_WEEKLY_REST_MIN;
      let cov;
      try {
        cov = evaluateCoverage({ sourceMember, freed: r.freed, roster, windowShifts });
      } catch {
        cov = { ok: false, partial: false, crewCount: 0, unassigned: r.freed.hours, roles: [] };
      }
      const coverageScore = cov.ok ? Math.max(0.4, 1 - 0.15 * (cov.crewCount - 1)) : (cov.partial ? 0.3 : 0.1);
      // Balance: rest restored (0.5) + breach resolution (0.2) + coverage (0.3).
      const score = 0.5 * Math.max(0, closed) + 0.2 * (resolvesWeekly ? 1 : 0) + 0.3 * coverageScore;
      const confidence = (resolvesWeekly && cov.ok) || (closed >= 0.5 && cov.ok) ? 'high' : 'medium';

      scored.push({
        id: sig,
        kind: r.kind,
        change: r.change,
        freedBlock: r.freed,
        restFrom,
        restTo: Number.isFinite(restTo) ? restTo : restFrom,
        resolvesWeekly,
        dailyBelow,
        coverage: cov,
        dayLabel: dayLabel(r.freed.date, effDate),
        blockLabel: `${r.freed.start}–${r.freed.end}`,
        score: Number.isFinite(score) ? score : 0,
        confidence,
      });
    } catch {
      // Skip a candidate that can't be scored rather than failing the panel.
    }
  }

  scored.sort((a, b) => (b.score - a.score) || (a.id < b.id ? -1 : 1));
  return scored.slice(0, limit);
}

// HH:MM + decimal hours → HH:MM (no overnight wrap needed for same-day trims).
function addHHMM(hhmm, hours) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + (m || 0) + Math.round(hours * 60);
  const hh = Math.floor((total % (24 * 60)) / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

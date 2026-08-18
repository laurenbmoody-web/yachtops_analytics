import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../../lib/supabaseClient';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import { buildStatusPeriods, getStatusForDay, getStatusLabel, CREW_STATUSES } from '../../../utils/crewStatus';
import { fetchCabins, fetchAssignments, createAssignment, updateAssignment, deleteAssignment } from '../utils/vesselCabins';
import { fetchTravelLegs } from '../../crew-profile/utils/crewCalendar';
import ConfigureCabinsModal from './ConfigureCabinsModal';
import TravelModal from './TravelModal';
import './crew-movements.css';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const STATUS_COLORS = { active: '#7FCBA6', on_leave: '#E6C079', rotational_leave: '#C3AEEA', medical_leave: '#E8A29A', training_leave: '#9DBCF0', travelling: '#7FD3CA', invited: '#D8D6CF' };
const ABOARD = new Set(['active']); // crew that need a bed
const AWAY = new Set(['on_leave', 'rotational_leave', 'medical_leave', 'training_leave', 'travelling']); // away, but still worth planning a bed for
const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const dstr = (d) => ymd(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const daysBetween = (a, b) => Math.round((b.getTime() - a.getTime()) / 86400000);
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
const tint = (hex, a) => { const n = parseInt((hex || '#7A6F8C').slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
const initials = (name) => (name || '?').split(' ').map((x) => x[0]).slice(0, 2).join('');
const ddmm = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

// Canonical yacht department order (Bridge first), with a role-seniority tiebreak
// so the captain sits at the very top of the crew list. Mirrors the helpers in
// crew-management/index.jsx.
const DEPT_ORDER = ['Bridge', 'Deck', 'Engineering', 'Interior', 'Galley', 'Spa', 'Security', 'Aviation', 'Shore / Management'];
const deptRank = (name) => {
  if (!name || name === '—') return 999;
  const i = DEPT_ORDER.indexOf(name);
  return i === -1 ? 500 : i;
};
const roleRank = (role) => {
  const s = String(role || '').toLowerCase();
  if (/capt|master/.test(s)) return 0;
  if (/chief officer|first officer|chief mate/.test(s)) return 1;
  if (/chief eng/.test(s)) return 1;
  if (/chief stew|head of (service|interior)|purser/.test(s)) return 1;
  if (/head chef|exec.* chef/.test(s)) return 1;
  if (/bosun/.test(s)) return 2;
  if (/2nd|second|first |1st/.test(s)) return 3;
  if (/3rd|third|sous/.test(s)) return 4;
  return 6;
};
// Sort by department, then seniority within it, then name. Captain (Bridge +
// role-rank 0) therefore lands at the very top.
const byDeptThenRole = (a, b) =>
  deptRank(a.department) - deptRank(b.department)
  || roleRank(a.roleTitle) - roleRank(b.roleTitle)
  || String(a.fullName || '').localeCompare(String(b.fullName || ''));

// The chart is a continuous, horizontally-scrollable timeline rather than one
// calendar month at a time — this fixed (but generous) window is rendered up
// front; scrolling within it is native/instant, no re-fetch or re-layout.
const WINDOW_BACK_MONTHS = 3;
const WINDOW_FWD_MONTHS = 12;
const DAY_W = 32; // px per day, shared by Presence + Cabins for a consistent feel

const CrewMovements = ({ members = [], tenantId, currentUserId, canManage, canNavigate }) => {
  const todayRef = useRef(new Date());
  const today = todayRef.current; // frozen for the component's lifetime — a stable reference for the scroll window and memoized date math below
  const [view, setView] = useState('presence');
  // Presence stays a plain single-month grid (unchanged from before) — only
  // Cabins is the continuous scrollable timeline below.
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const totalDays = daysIn(calYear, calMonth);
  const prevPresenceMonth = () => { if (calMonth === 0) { setCalYear((y) => y - 1); setCalMonth(11); } else setCalMonth((m) => m - 1); };
  const nextPresenceMonth = () => { if (calMonth === 11) { setCalYear((y) => y + 1); setCalMonth(0); } else setCalMonth((m) => m + 1); };
  const [historyByUser, setHistoryByUser] = useState({});
  const [cabins, setCabins] = useState([]);
  const [assigns, setAssigns] = useState([]);
  const [travel, setTravel] = useState([]);
  const [travelLegs, setTravelLegs] = useState([]);
  const [travelModal, setTravelModal] = useState(null); // { entry } | { entry: null } | null
  const [deptColors, setDeptColors] = useState({});
  const [sexMap, setSexMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [configOpen, setConfigOpen] = useState(false);
  const [selCrew, setSelCrew] = useState(null);
  const [dragKind, setDragKind] = useState(null); // {type:'assign'|'bar', ...}
  const [pop, setPop] = useState(null);           // move popover
  const [handover, setHandover] = useState(null); // conflict dialog
  const [hoDate, setHoDate] = useState('');       // chosen handover / changeover date (yyyy-mm-dd)
  const [flashId, setFlashId] = useState(null);   // bar to pulse after "Move anyway"
  const [focusLabel, setFocusLabel] = useState('');
  const [dayPick, setDayPick] = useState(null);   // quick status picker {userId, fullName, startDate, endDate, count, cur, x, y}
  const [dragSel, setDragSel] = useState(null);   // live drag highlight {userId, a, b} (day indices within the month)
  const [painting, setPainting] = useState(false);
  const dragRef = useRef(null);                   // {userId, a, b} while a click-drag is in progress
  const [barTip, setBarTip] = useState(null);     // cabin-bar hover tooltip {nm, dt, x, y}

  const memberById = useMemo(() => Object.fromEntries(members.map((m) => [m.user_id, m])), [members]);
  const memberIds = useMemo(() => members.map((m) => m.user_id).filter(Boolean), [members]);
  const crewAboard = useMemo(() => members.filter((m) => ABOARD.has(m.status)).length, [members]);
  const deptOf = (uid) => deptColors[memberById[uid]?.department] || '#7A6F8C';
  // Rows grouped by department (Bridge first) with the captain pinned to the top.
  const orderedMembers = useMemo(() => [...members].sort(byDeptThenRole), [members]);

  // ── the continuous scroll window ─────────────────────────────────────────────
  const rangeStart = useMemo(() => new Date(today.getFullYear(), today.getMonth() - WINDOW_BACK_MONTHS, 1), [today]);
  const rangeEnd = useMemo(() => new Date(today.getFullYear(), today.getMonth() + WINDOW_FWD_MONTHS + 1, 1), [today]); // exclusive
  const viewDays = useMemo(() => daysBetween(rangeStart, rangeEnd), [rangeStart, rangeEnd]);
  const todayIndex = useMemo(() => daysBetween(rangeStart, new Date(today.getFullYear(), today.getMonth(), today.getDate())), [rangeStart, today]);
  // Month bands for the header label row — each spans its own slice of days
  // within the window (clipped at either edge), so the label sits directly
  // above the days it covers as you scroll past it.
  const monthBands = useMemo(() => {
    const bands = [];
    let cur = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    while (cur < rangeEnd) {
      const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      const segStart = cur > rangeStart ? cur : rangeStart;
      const segEnd = next < rangeEnd ? next : rangeEnd;
      bands.push({
        label: `${MONTHS[cur.getMonth()]} ${cur.getFullYear()}`,
        left: daysBetween(rangeStart, segStart) * DAY_W,
        width: daysBetween(segStart, segEnd) * DAY_W,
        days: daysBetween(segStart, segEnd),
      });
      cur = next;
    }
    return bands;
  }, [rangeStart, rangeEnd]);
  const leftPx = (dayIdx) => dayIdx * DAY_W;
  // Labelled (5th/10th/15th/…-of-month) day indices — shared by the header
  // ticks and a matching guide line drawn into every bed row, so a date can
  // be traced straight down the chart instead of counted by eye. Months
  // aren't evenly divisible by 5, so this can't be a repeating CSS pattern —
  // computed once from the real calendar dates in the window.
  const fiveDayMarks = useMemo(() => {
    const marks = [];
    for (let i = 0; i < viewDays; i += 1) { if (addDays(rangeStart, i).getDate() % 5 === 0) marks.push(i); }
    return marks;
  }, [rangeStart, viewDays]);

  const AWAY = new Set(['on_leave', 'rotational_leave', 'medical_leave', 'training_leave']);
  const TRANS_ICON = { Flight: 'Plane', Train: 'TrainFront', Ferry: 'Ship', Car: 'Car', Other: 'MapPin' };
  const dirOf = (e) => (e.kind === 'active' ? 'arr' : AWAY.has(e.kind) ? 'dep' : 'transit');
  // Upcoming only (today → end of the rendered window) — past travel is still
  // visible as history in the chart itself, no need to repeat it in this list.
  const upcomingTravel = useMemo(() => {
    const from = dstr(today), to = dstr(addDays(rangeEnd, -1));
    return travel
      .filter((e) => (e.transport || e.from_location || e.to_location) && (e.start_date || '').slice(0, 10) >= from && (e.start_date || '').slice(0, 10) <= to)
      .sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  }, [travel, today, rangeEnd]);
  const legsByEntry = useMemo(() => { const m = {}; travelLegs.forEach((l) => { (m[l.entry_id] = m[l.entry_id] || []).push(l); }); return m; }, [travelLegs]);

  // presence history
  useEffect(() => {
    if (!tenantId || memberIds.length === 0) { setHistoryByUser({}); return undefined; }
    let dead = false;
    (async () => {
      const { data } = await supabase.from('crew_status_history')
        .select('user_id, new_status, changed_at').eq('tenant_id', tenantId).in('user_id', memberIds)
        .order('changed_at', { ascending: true });
      if (dead) return;
      const g = {}; (data || []).forEach((r) => { (g[r.user_id] = g[r.user_id] || []).push(r); });
      setHistoryByUser(g);
    })();
    return () => { dead = true; };
  }, [tenantId, memberIds.join(','), refresh]);

  // cabins + assignments + dept colours
  const loadCabins = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const [cabs, asg, dep, trv, sx, legs] = await Promise.all([
      fetchCabins(tenantId), fetchAssignments(tenantId),
      supabase.from('departments').select('name, color'),
      supabase.from('crew_calendar_entries').select('*').eq('tenant_id', tenantId),
      memberIds.length ? supabase.from('crew_personal_details').select('user_id, sex').in('user_id', memberIds) : Promise.resolve({ data: [] }),
      fetchTravelLegs(tenantId),
    ]);
    setCabins(cabs);
    setAssigns(asg);
    setDeptColors(Object.fromEntries((dep.data || []).map((d) => [d.name, d.color])));
    setTravel(trv.data || []);
    setTravelLegs(legs);
    setSexMap(Object.fromEntries((sx.data || []).map((r) => [r.user_id, r.sex === 'Male' ? 'M' : r.sex === 'Female' ? 'F' : ''])));
    setLoading(false);
  }, [tenantId, memberIds]);
  const sexOf = (uid) => sexMap[uid] || '';
  useEffect(() => { loadCabins(); }, [loadCabins, refresh]);

  // ── flat bed rows (grouped by cabin) ─────────────────────────────────────────
  const bedRows = useMemo(() => {
    const rows = [];
    cabins.forEach((c) => (c.beds || []).forEach((b) => rows.push({ bedId: b.id, cabinId: c.id, cabin: c.name, deck: c.deck, label: b.label })));
    return rows;
  }, [cabins]);

  // Bar geometry. A bed row is one lane tall until two stays overlap in it —
  // then it grows a lane per collision so nothing is drawn on top of anything
  // else. Before this, a short stay sitting inside a longer one was painted
  // over and became invisible AND unclickable, so a double-booking was
  // impossible to even find, let alone fix.
  const LANE_H = 20;   // bar height
  const LANE_GAP = 3;  // between stacked bars
  const TRACK_PAD = 3; // .mv-track top/bottom padding around a single lane
  const trackHeight = (lanes) => TRACK_PAD * 2 + lanes * LANE_H + (lanes - 1) * LANE_GAP;

  // ── map an assignment onto the scroll window → {aDay, lvDay, contBefore, contAfter}
  // (day indices are 0-based offsets from rangeStart, so they convert straight
  // to pixels via leftPx() — contBefore/contAfter mark a stay that's truncated
  // by the edge of the rendered window, same idea as before, just wider now.)
  const span = useCallback((a) => {
    const s = new Date(`${a.start_date}T00:00:00`);
    const e = a.end_date ? new Date(`${a.end_date}T00:00:00`) : null;
    if (s >= rangeEnd) return null;
    if (e && e <= rangeStart) return null;
    const contBefore = s < rangeStart;
    const aDay = contBefore ? 0 : daysBetween(rangeStart, s);
    let lvDay, contAfter = false;
    if (!e || e > rangeEnd) { lvDay = viewDays; contAfter = true; }
    else { lvDay = daysBetween(rangeStart, e); }
    if (lvDay <= aDay) return null;
    return { aDay, lvDay, contBefore, contAfter };
  }, [rangeStart, rangeEnd, viewDays]);

  // Lane per stay, per bed — classic interval packing: each stay takes the
  // first lane whose previous occupant has already left. One lane is the norm;
  // a second only appears where two people genuinely hold the same bed at once.
  const lanesByBed = useMemo(() => {
    const out = {};
    bedRows.forEach(({ bedId }) => {
      const list = assigns
        .filter((a) => a.bed_id === bedId)
        .map((a) => ({ a, sp: span(a) }))
        .filter((x) => x.sp)
        .sort((x, y) => x.sp.aDay - y.sp.aDay || x.sp.lvDay - y.sp.lvDay);
      const laneEnds = [];   // lvDay of the last stay placed in each lane
      const laneOf = {};
      list.forEach(({ a, sp }) => {
        let lane = laneEnds.findIndex((end) => end <= sp.aDay);
        if (lane === -1) { laneEnds.push(sp.lvDay); lane = laneEnds.length - 1; }
        else laneEnds[lane] = sp.lvDay;
        laneOf[a.id] = lane;
      });
      out[bedId] = { lanes: Math.max(1, laneEnds.length), laneOf };
    });
    return out;
  }, [bedRows, assigns, span]);

  // ── away runs, per crew member, across the scroll window ─────────────────────
  // The presence board's statuses, projected onto the cabins timeline: a run is
  // a stretch of days the crew member is off the vessel (leave, travelling).
  // Their bed stays reserved — that's deliberate, someone on rotation comes back
  // to it — but the bar has to SHOW the absence, otherwise Cabins silently
  // contradicts Presence. Day indices are 0-based offsets from rangeStart, so
  // they convert straight to pixels via leftPx(), same as span().
  const awayRunsByUser = useMemo(() => {
    const out = {};
    Object.entries(historyByUser).forEach(([uid, hist]) => {
      const periods = buildStatusPeriods(hist || []);
      if (!periods.length) return;
      const runs = [];
      let open = null;
      for (let d = 0; d < viewDays; d += 1) {
        const st = getStatusForDay(periods, addDays(rangeStart, d));
        if (st && AWAY.has(st)) {
          if (open && open.status === st) open.end = d;
          else { if (open) runs.push(open); open = { start: d, end: d, status: st }; }
        } else if (open) { runs.push(open); open = null; }
      }
      if (open) runs.push(open);
      out[uid] = runs;
    });
    return out;
  }, [historyByUser, rangeStart, viewDays]);

  // First day of leave falling inside a stay — what "End stay" should offer by
  // default, since ending a berth on the day someone leaves is the usual reason
  // to reach for it at all.
  const leaveDateWithin = useCallback((a) => {
    const sp = span(a);
    if (!sp) return '';
    const run = (awayRunsByUser[a.user_id] || []).find((r) => r.end >= sp.aDay && r.start < sp.lvDay);
    if (!run) return '';
    return dstr(addDays(rangeStart, Math.max(run.start, sp.aDay)));
  }, [awayRunsByUser, span, rangeStart]);

  // Cabins where M and F crew overlap on any night → flag for review (couples
  // aside, you usually don't want mixed-sex sharing).
  const cabinMixed = useMemo(() => {
    const map = {};
    cabins.forEach((c) => {
      const bedIds = new Set((c.beds || []).map((b) => b.id));
      const list = assigns.filter((a) => bedIds.has(a.bed_id) && span(a));
      let mixed = false;
      for (let i = 0; i < list.length && !mixed; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const s1 = sexOf(list[i].user_id), s2 = sexOf(list[j].user_id);
          if (s1 && s2 && s1 !== s2
            && list[i].start_date < (list[j].end_date || '9999-12-31')
            && list[j].start_date < (list[i].end_date || '9999-12-31')) { mixed = true; break; }
        }
      }
      map[c.id] = mixed;
    });
    return map;
  }, [cabins, assigns, sexMap, span]); // eslint-disable-line

  // ── who's aboard but not berthed (unberthed tray) ────────────────────────────
  const unberthed = useMemo(() => {
    const berthed = new Set(assigns.filter((a) => span(a)).map((a) => a.user_id));
    return members.filter((m) => ABOARD.has(m.status) && !berthed.has(m.user_id)).sort(byDeptThenRole);
  }, [members, assigns, span]);

  // ── crew currently away (leave / travelling) and not berthed ─────────────────
  // They aren't aboard so they don't need a bed *now*, but they still belong on
  // the planning board — drag one onto a bed to reserve it for their return.
  const onLeave = useMemo(() => {
    const berthed = new Set(assigns.filter((a) => span(a)).map((a) => a.user_id));
    return members.filter((m) => AWAY.has(m.status) && !berthed.has(m.user_id)).sort(byDeptThenRole);
  }, [members, assigns, span]);

  // ── coalesce same-crew same-bed contiguous stays in the DB, then reload ──────
  const reconcile = useCallback(async (rows) => {
    const groups = {};
    rows.forEach((a) => { const k = `${a.user_id}|${a.bed_id}`; (groups[k] = groups[k] || []).push(a); });
    const ops = [];
    Object.values(groups).forEach((list) => {
      list.sort((x, y) => (x.start_date < y.start_date ? -1 : 1));
      let cur = list[0];
      for (let i = 1; i < list.length; i += 1) {
        const s = list[i];
        const curEnd = cur.end_date; // null = open
        const touch = curEnd == null || s.start_date <= curEnd;
        if (touch) {
          const newEnd = (curEnd == null || s.end_date == null) ? null : (s.end_date > curEnd ? s.end_date : curEnd);
          if (newEnd !== cur.end_date) ops.push(updateAssignment(cur.id, { end_date: newEnd }));
          cur.end_date = newEnd;
          ops.push(deleteAssignment(s.id));
        } else cur = s;
      }
    });
    if (ops.length) { await Promise.all(ops); }
    return ops.length > 0;
  }, []);

  const reload = useCallback(async () => {
    const fresh = await fetchAssignments(tenantId);
    await reconcile(fresh);
    setRefresh((r) => r + 1);
  }, [tenantId, reconcile]);

  // ── overlap detection (cross-crew) on a bed ──────────────────────────────────
  const overlapsOnBed = (list, cand) => list.find((a) => a.id !== cand.id && a.bed_id === cand.bed_id && a.user_id !== cand.user_id
    && a.start_date < (cand.end_date || '9999-12-31') && cand.start_date < (a.end_date || '9999-12-31'));

  // `undo` reverts the DB write the calling action already made — "No" has to
  // actually put things back, not just close the dialog and reload (which
  // left the new, overlapping placement sitting in the database).
  // `onMoveAnyway` is the third option: leave the overlap in place for now
  // (the write already happened — this just doesn't undo it) and pulse the
  // bar that landed there, then open the same move popover used elsewhere so
  // it's easy to drag it onto a different bed right away.
  const promptHandover = (moved, fresh, { undo, onMoveAnyway }) => {
    const other = overlapsOnBed(fresh, moved);
    if (!other) return false;
    const early = other.start_date <= moved.start_date ? other : moved;
    const late = other.start_date <= moved.start_date ? moved : other;
    setHoDate(late.start_date); // default the changeover to when the incoming crew currently starts
    setHandover({
      inName: memberById[late.user_id]?.fullName, outName: memberById[early.user_id]?.fullName,
      earlyId: early.id, lateId: late.id, minDate: early.start_date,
      // The changeover date is editable in the dialog; on accept the outgoing
      // crew's stay ends on it and the incoming crew's stay starts on it.
      accept: async (date) => {
        setHandover(null);
        await updateAssignment(early.id, { end_date: date });
        await updateAssignment(late.id, { start_date: date });
        await reload();
      },
      reject: async () => { setHandover(null); await undo(); },
      moveAnyway: () => { setHandover(null); onMoveAnyway(); },
    });
    return true;
  };

  // Flash the just-placed bar and open its move popover — used by "Move
  // anyway", which deliberately leaves the overlap in place rather than
  // resolving it automatically. The write already happened, but the chart's
  // own state hasn't been refreshed yet (every other path either reloads on
  // accept or reverts on undo) — reload here too, or the overlapping bar
  // won't actually be visible to flash. The flash itself keeps pulsing (see
  // the effect below) until the overlap is actually cleared, not for a fixed
  // amount of time.
  const flashThenMove = async (a) => {
    setFlashId(a.id);
    await reload();
    openMoveManual(a);
  };
  // Keeps "Move anyway"'s flash going for as long as the conflict is real —
  // stops the moment this bed no longer has anyone overlapping the flashed
  // stay (moved elsewhere, dates changed, or removed entirely).
  useEffect(() => {
    if (!flashId) return;
    const cand = assigns.find((x) => x.id === flashId);
    if (!cand || !overlapsOnBed(assigns, cand)) setFlashId(null);
  }, [flashId, assigns]);

  // ── actions ──────────────────────────────────────────────────────────────────
  const assignToBed = async (bedId, userId) => {
    // default a new stay to start today, open-ended forward
    const startD = dstr(today);
    const row = await createAssignment({ tenantId, bedId, userId, startDate: startD, endDate: null, createdBy: currentUserId });
    setSelCrew(userId);
    const fresh = await fetchAssignments(tenantId);
    const handled = promptHandover({ ...row }, fresh, {
      undo: async () => { await deleteAssignment(row.id); await reload(); },
      onMoveAnyway: () => flashThenMove({ ...row }),
    });
    if (!handled) await reload();
  };
  const moveWholeBar = async (assignId, bedId) => {
    const a = assigns.find((x) => x.id === assignId); if (!a || a.bed_id === bedId) return;
    const originalBedId = a.bed_id;
    await updateAssignment(assignId, { bed_id: bedId });
    setSelCrew(a.user_id);
    const fresh = await fetchAssignments(tenantId);
    const moved = fresh.find((x) => x.id === assignId);
    const handled = promptHandover(moved, fresh, {
      undo: async () => { await updateAssignment(assignId, { bed_id: originalBedId }); await reload(); },
      onMoveAnyway: () => flashThenMove(moved),
    });
    if (!handled) await reload();
  };
  const splitMove = async (assignId, bedId, dateStr) => {
    const a = assigns.find((x) => x.id === assignId); if (!a) return;
    const origEnd = a.end_date;
    await updateAssignment(assignId, { end_date: dateStr });
    const row = await createAssignment({ tenantId, bedId, userId: a.user_id, startDate: dateStr, endDate: origEnd, createdBy: currentUserId });
    setPop(null); setSelCrew(a.user_id);
    const fresh = await fetchAssignments(tenantId);
    const handled = promptHandover({ ...row }, fresh, {
      undo: async () => { await deleteAssignment(row.id); await updateAssignment(assignId, { end_date: origEnd }); await reload(); },
      onMoveAnyway: () => flashThenMove({ ...row }),
    });
    if (!handled) await reload();
  };
  const endStay = async (assignId, dateStr) => { await updateAssignment(assignId, { end_date: dateStr }); setPop(null); await reload(); };
  // Change when a stay begins. Distinct from splitMove: that ends the stay and
  // starts a fresh one from the date (a cabin change mid-tour), which for the
  // SAME bed reconcile() immediately merges back — so "they actually arrive on
  // the 17th" had no way to be recorded at all. If the new date collides with
  // whoever else holds the bed, the usual handover prompt runs.
  const startStay = async (assignId, dateStr) => {
    const a = assigns.find((x) => x.id === assignId); if (!a) return;
    const origStart = a.start_date;
    if (dateStr === origStart) { setPop(null); return; }
    await updateAssignment(assignId, { start_date: dateStr });
    setPop(null); setSelCrew(a.user_id);
    const fresh = await fetchAssignments(tenantId);
    const moved = fresh.find((x) => x.id === assignId);
    const handled = promptHandover(moved, fresh, {
      undo: async () => { await updateAssignment(assignId, { start_date: origStart }); await reload(); },
      onMoveAnyway: () => flashThenMove(moved),
    });
    if (!handled) await reload();
  };
  const removeStay = async (assignId) => { await deleteAssignment(assignId); setPop(null); await reload(); };

  // Flight → cabins: switch to the Cabins view, select the person, scroll to
  // their bed. (The reverse — bar → flight — highlights the flight rows via the
  // shared selCrew, since the board sits above the chart.)
  const selectFromFlight = (uid) => {
    setSelCrew(uid); setView('cabins'); setPop(null);
    setTimeout(() => {
      const a = assigns.find((x) => x.user_id === uid && span(x));
      if (a) document.getElementById(`bar-${a.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }, 80);
  };
  // Bar → flight: scroll the matching flight row into view (highlight is via selCrew).
  const scrollToFlight = (uid) => {
    const e = upcomingTravel.find((x) => x.user_id === uid);
    if (e) document.getElementById(`flt-${e.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // ── shared horizontal scroll: land on "today" (with a little run-up so it's
  // not pinned to the very left edge), and keep the month chip in sync with
  // whatever's actually in view as the user scrolls. ────────────────────────────
  const scrollRef = useRef(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    el.scrollLeft = Math.max(0, (todayIndex - 7) * DAY_W); // set before paint — no visible jump from 0
    const onScroll = () => {
      const x = el.scrollLeft;
      const band = monthBands.find((b) => x < b.left + b.width) || monthBands[monthBands.length - 1];
      if (band) setFocusLabel(band.label);
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [view, todayIndex, monthBands]);

  const scrollByMonth = (dir) => {
    const el = scrollRef.current; if (!el) return;
    const band = monthBands.find((b) => b.label === focusLabel);
    const days = band ? Math.max(band.days, 28) : 30;
    el.scrollBy({ left: dir * days * DAY_W, behavior: 'smooth' });
  };
  const scrollToToday = () => { const el = scrollRef.current; if (el) el.scrollTo({ left: Math.max(0, (todayIndex - 7) * DAY_W), behavior: 'smooth' }); };

  // ── auto-scroll the page while dragging a crew chip up into the chart ─────────
  // The unberthed tray sits at the bottom of a long list of cabins, so the bed
  // you want to drop onto is often scrolled off the top. Browsers don't
  // auto-scroll the window during an HTML5 drag, so we do it: while a drag is
  // live, listen for dragover on the window and, when the pointer nears the top
  // or bottom edge of the viewport, scroll toward it.
  useEffect(() => {
    if (!dragKind) return undefined;
    const EDGE = 90;      // px band at each edge that triggers scrolling
    const MAX_STEP = 22;  // px per frame at the very edge
    let pointerY = null;
    let raf = null;
    const step = () => {
      raf = null;
      if (pointerY == null) return;
      const h = window.innerHeight;
      let dy = 0;
      if (pointerY < EDGE) dy = -MAX_STEP * (1 - pointerY / EDGE);
      else if (pointerY > h - EDGE) dy = MAX_STEP * (1 - (h - pointerY) / EDGE);
      if (dy) {
        window.scrollBy(0, dy);
        raf = requestAnimationFrame(step);
      }
    };
    const onDragOver = (e) => {
      pointerY = e.clientY;
      if (raf == null) raf = requestAnimationFrame(step);
    };
    window.addEventListener('dragover', onDragOver);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [dragKind]);

  // ── quick status paint (single day or a click-dragged range) ─────────────────
  // Clicking a square — or dragging across a row — opens a small swatch popover;
  // picking a status sets that day / span. We model it on the existing
  // status-history timeline: write the chosen status at the start of the span and
  // restore the underlying status the morning after it, so nothing beyond the
  // painted span is disturbed. These rows are tagged source:'calendar' so they
  // stay out of the formal audit trail (StatusHistoryTab / profileActivity
  // exclude that source).
  const PAINT_HOUR = 12; // noon slot — a paint always wins over a same-day boundary
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const closePick = () => { setDayPick(null); setDragSel(null); };
  const paintRange = async (userId, startDate, endDate, newStatus) => {
    if (!canManage || !tenantId || painting) return;
    setPainting(true);
    try {
      let d0 = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
      let d1 = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
      if (d1 < d0) { const t = d0; d0 = d1; d1 = t; }
      const afterEnd = new Date(d1); afterEnd.setDate(afterEnd.getDate() + 1);
      const paintAt = new Date(d0); paintAt.setHours(PAINT_HOUR, 0, 0, 0);
      const d0Mid = new Date(d0); d0Mid.setHours(0, 0, 0, 0);
      const afterEndMid = new Date(afterEnd); afterEndMid.setHours(0, 0, 0, 0);

      // Replace, don't stack: drop our own paints/restores inside the span so
      // re-painting an overlapping range starts clean. Manual/seed history is
      // left untouched.
      await supabase.from('crew_status_history').delete()
        .eq('tenant_id', tenantId).eq('user_id', userId).eq('source', 'calendar')
        .gte('changed_at', d0Mid.toISOString()).lt('changed_at', afterEndMid.toISOString());

      // What the span-start / the morning-after show WITHOUT our paint present.
      const { data: hist } = await supabase.from('crew_status_history')
        .select('user_id, new_status, changed_at')
        .eq('tenant_id', tenantId).eq('user_id', userId)
        .order('changed_at', { ascending: true });
      const periods = buildStatusPeriods(hist || []);
      const baseStart = getStatusForDay(periods, d0);
      const baseAfter = getStatusForDay(periods, afterEnd);

      const single = sameDay(d0, d1);
      if (!(single && newStatus === baseStart)) {
        const rows = [{
          tenant_id: tenantId, user_id: userId, new_status: newStatus, old_status: baseStart || null,
          changed_by: currentUserId || null, changed_at: paintAt.toISOString(), source: 'calendar',
        }];
        // Keep the paint from bleeding past the span: unless a change already
        // lands the morning after, restore the underlying status there.
        const afterHasBoundary = (hist || []).some((h) => sameDay(new Date(h.changed_at), afterEnd));
        const restoreTo = baseAfter || baseStart || 'active';
        if (restoreTo !== newStatus && !afterHasBoundary) {
          rows.push({
            tenant_id: tenantId, user_id: userId, new_status: restoreTo, old_status: newStatus,
            changed_by: currentUserId || null, changed_at: afterEndMid.toISOString(), source: 'calendar',
          });
        }
        const { error } = await supabase.from('crew_status_history').insert(rows);
        if (error) { window.showToast?.(error.message || 'Could not update status', 'error'); return; }
      }

      // Keep the live badge in sync when today falls inside the painted span.
      const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
      if (todayMid >= d0Mid && todayMid < afterEndMid) {
        await supabase.from('tenant_members').update({ status: newStatus })
          .eq('tenant_id', tenantId).eq('user_id', userId);
      }

      closePick();
      setRefresh((r) => r + 1);
    } finally {
      setPainting(false);
    }
  };

  // Finish a click-drag anywhere: turn the selected span into a status popover.
  useEffect(() => {
    const onUp = (e) => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      const lo = Math.min(d.a, d.b);
      const hi = Math.max(d.a, d.b);
      const startDate = new Date(calYear, calMonth, lo + 1);
      const endDate = new Date(calYear, calMonth, hi + 1);
      const periods = buildStatusPeriods(historyByUser[d.userId] || []);
      setDayPick({
        userId: d.userId,
        fullName: memberById[d.userId]?.fullName || '',
        startDate, endDate, count: hi - lo + 1,
        cur: getStatusForDay(periods, startDate),
        x: e.clientX, y: e.clientY,
      });
    };
    window.addEventListener('pointerup', onUp);
    return () => window.removeEventListener('pointerup', onUp);
  }, [calYear, calMonth, memberById, historyByUser]);

  // ── presence rendering (plain single-month grid, unchanged) ─────────────────
  // Today's column is ringed in terracotta — the single-month grid's answer to
  // the cabins chart's today line. Null whenever a different month is on show.
  const presenceToday =
    calYear === today.getFullYear() && calMonth === today.getMonth() ? today.getDate() : null;

  const renderPresence = () => (
    <div className="mv-grid">
      <div className="mv-row">
        <div className="mv-name" />
        {Array.from({ length: totalDays }, (_, i) => (
          <div
            key={i}
            className={`mv-dnum${(i + 1) % 5 === 0 ? ' d5' : ''}${presenceToday === i + 1 ? ' is-today' : ''}`}
          >
            {i + 1}
          </div>
        ))}
      </div>
      {orderedMembers.length === 0 ? <p className="mv-empty">No crew to display.</p> : orderedMembers.map((m) => {
        const periods = buildStatusPeriods(historyByUser[m.user_id] || []);
        return (
          <div key={m.user_id} className="mv-row">
            <div className="mv-name" title={m.fullName}>{m.fullName || '—'}</div>
            {Array.from({ length: totalDays }, (_, i) => {
              const cellDate = new Date(calYear, calMonth, i + 1);
              const st = getStatusForDay(periods, cellDate);
              const isToday = presenceToday === i + 1;
              const inSel = dragSel && dragSel.userId === m.user_id && i >= Math.min(dragSel.a, dragSel.b) && i <= Math.max(dragSel.a, dragSel.b);
              const statusLabel = st ? `${m.fullName}: ${getStatusLabel(st)}` : '';
              return (
                <div
                  key={i}
                  className={`mv-cell${isToday ? ' is-today' : ''}${canManage ? ' clickable' : ''}${inSel ? ' sel' : ''}`}
                  title={
                    canManage
                      ? `${m.fullName}: ${st ? getStatusLabel(st) : 'no status'}${isToday ? ' · today' : ''} — click, or drag across days, to change`
                      : (isToday ? `${statusLabel || 'Today'}${statusLabel ? ' · today' : ''}` : statusLabel)
                  }
                  style={st ? { background: STATUS_COLORS[st] } : undefined}
                  onPointerDown={canManage ? (e) => { if (e.button !== 0) return; e.preventDefault(); dragRef.current = { userId: m.user_id, a: i, b: i }; setDragSel({ userId: m.user_id, a: i, b: i }); } : undefined}
                  onPointerEnter={canManage ? () => { const d = dragRef.current; if (!d || d.userId !== m.user_id) return; d.b = i; setDragSel({ userId: m.user_id, a: d.a, b: i }); } : undefined}
                />
              );
            })}
          </div>
        );
      })}
      <div className="mv-legend">{CREW_STATUSES.map(({ value, label }) => <span key={value} className="mv-leg"><i style={{ background: STATUS_COLORS[value] }} />{label}</span>)}</div>
    </div>
  );

  // ── cabins booking chart ───────────────────────────────────────────────────────
  const renderCabins = () => {
    if (cabins.length === 0) {
      return <div className="mv-setup"><p>No cabins set up yet.</p>{canManage && <button type="button" className="mv-btn primary" onClick={() => setConfigOpen(true)}>Configure cabins</button>}</div>;
    }
    let lastCabin = null;
    const rows = bedRows.map((bd) => {
      const isNewGroup = bd.cabin !== lastCabin;
      lastCabin = bd.cabin;
      return { ...bd, isNewGroup };
    });
    return (
      <div className="mv-chart" onClick={() => { setSelCrew(null); setPop(null); }}>
        {/* Genuinely split layout — the name column is NOT inside the
            scrolling element at all, so it can't be affected by anything
            that happens to the scroll position (unlike position:sticky,
            which turned out unreliable here). Row heights are matched
            pixel-for-pixel between the two columns so they stay aligned. */}
        <div className="mv-chartbody">
          <div className="mv-namescol">
            <div className="mv-namerow-month" />
            <div className="mv-namerow-day" />
            {rows.map((bd) => (
              <React.Fragment key={bd.bedId}>
                {bd.isNewGroup && (
                  <div className="mv-namegroup">
                    {bd.cabin}{bd.deck ? ` · ${bd.deck.replace(' deck', '')}` : ''}
                    {cabinMixed[bd.cabinId] && <span className="mv-mixed sm" title="Male and female crew share this cabin">⚠</span>}
                  </div>
                )}
                <div className="mv-namerow" style={{ height: trackHeight(lanesByBed[bd.bedId]?.lanes || 1) }}>{bd.label}</div>
              </React.Fragment>
            ))}
          </div>
          <div className="mv-scrollx" ref={scrollRef} style={{ '--day-w': `${DAY_W}px` }}>
            <div className="mv-monthtrack" style={{ width: viewDays * DAY_W }}>
              {monthBands.map((b) => <span key={b.label} className="mv-monthband" style={{ left: b.left, width: b.width }}>{b.label}</span>)}
            </div>
            <div className="mv-htrack" style={{ width: viewDays * DAY_W }}>
              <div className="mv-todayline" style={{ left: leftPx(todayIndex) }} />
              {fiveDayMarks.map((i) => <span key={i} className="mv-dtick" style={{ left: leftPx(i) }}>{addDays(rangeStart, i).getDate()}</span>)}
            </div>
            {rows.map((bd) => {
              const rowAssigns = assigns.filter((a) => a.bed_id === bd.bedId).map((a) => ({ a, sp: span(a) })).filter((x) => x.sp);
              // gaps
              const covered = new Array(viewDays).fill(false);
              rowAssigns.forEach(({ sp }) => { for (let d = sp.aDay; d < sp.lvDay; d += 1) covered[d] = true; });
              const gaps = [];
              let g = 0; while (g < viewDays) { if (!covered[g]) { let e = g; while (e + 1 < viewDays && !covered[e + 1]) e += 1; gaps.push([g, e]); g = e + 1; } else g += 1; }
              return (
                <React.Fragment key={bd.bedId}>
                  {bd.isNewGroup && <div className="mv-groupline" />}
                  <div className="mv-track" style={{ width: viewDays * DAY_W, height: trackHeight(lanesByBed[bd.bedId]?.lanes || 1) }} onDragOver={(e) => { if (!canManage) return; e.preventDefault(); e.currentTarget.classList.add('drop'); }} onDragLeave={(e) => e.currentTarget.classList.remove('drop')}
                    onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drop'); if (!canManage) return; const dk = dragKind; setDragKind(null); if (!dk) return; if (dk.type === 'assign') assignToBed(bd.bedId, dk.userId); else moveWholeBar(dk.assignId, bd.bedId); }}>
                    {/* Guide lines rendered INSIDE the track (not a full-height
                        overlay behind it) — the track has its own opaque
                        background, so an overlay lower in the stack would be
                        invisible; a real child always paints over the box's
                        own background regardless of z-index. */}
                    {fiveDayMarks.map((i) => <span key={`vg-${i}`} className="mv-vguide" style={{ left: leftPx(i) }} />)}
                    <span className="mv-vguide today" style={{ left: leftPx(todayIndex) }} />
                    {gaps.map(([a, b]) => { const nights = b - a + 1, w = nights * DAY_W; return <div key={`gap-${a}`} className={`mv-gap${nights === 1 ? ' one' : ''}`} style={{ left: leftPx(a), width: w }} title={`Free — ${nights} night${nights > 1 ? 's' : ''}`}>{w > 90 ? `${nights} night${nights > 1 ? 's' : ''} free` : w > 40 ? `${nights}n` : ''}</div>; })}
                    {rowAssigns.map(({ a, sp }) => {
                      const m = memberById[a.user_id]; const w = (sp.lvDay - sp.aDay) * DAY_W;
                      const bg = tint(deptOf(a.user_id), 0.34); const nm = m?.fullName || '—';
                      // Always the full name — it ellipsizes to fit and reveals in
                      // full on hover (a short handover sliver is too narrow to show
                      // inline), so every bar is identifiable.
                      const lbl = nm; const dim = selCrew && selCrew !== a.user_id;
                      // Leave/travel falling inside this stay — hatched over the
                      // bar so the berth still reads as held while showing the
                      // crew member is off the vessel (matches Presence).
                      const away = (awayRunsByUser[a.user_id] || [])
                        .map((r) => ({ ...r, from: Math.max(r.start, sp.aDay), to: Math.min(r.end + 1, sp.lvDay) }))
                        .filter((r) => r.to > r.from);
                      // Someone else holding this same bed at the same time.
                      // Both bars stay visible (own lane) and get flagged.
                      const clash = overlapsOnBed(assigns, a);
                      const lane = lanesByBed[bd.bedId]?.laneOf?.[a.id] || 0;
                      return (
                        <div key={a.id} className={`mv-bar${!sp.contBefore ? ' j' : ''}${!sp.contAfter ? ' l' : ''}${selCrew === a.user_id ? ' sel' : ''}${flashId === a.id ? ' flash' : ''}${clash ? ' clash' : ''}`} id={`bar-${a.id}`}
                          draggable={canManage} onDragStart={() => { canManage && setDragKind({ type: 'bar', assignId: a.id }); setBarTip(null); }}
                          onClick={(e) => { e.stopPropagation(); setSelCrew(a.user_id); if (canManage) openMove(a, e); }}
                          onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setBarTip({ nm, dt: `${a.start_date}${a.end_date ? ` → ${a.end_date}` : ' (open)'}${clash ? ` · double-booked with ${memberById[clash.user_id]?.fullName || 'another crew member'}` : ''}`, x: Math.min(Math.max(e.clientX, r.left + 24), r.right - 24), y: r.top - 6 }); }}
                          onMouseLeave={() => setBarTip(null)}
                          style={{ left: leftPx(sp.aDay), width: w, background: bg, opacity: dim ? 0.4 : 1, top: TRACK_PAD + lane * (LANE_H + LANE_GAP), height: LANE_H }}>
                          {away.map((r) => (
                            <span
                              key={`away-${r.from}`}
                              className="mv-baraway"
                              style={{ left: (r.from - sp.aDay) * DAY_W, width: (r.to - r.from) * DAY_W }}
                              title={`${nm}: ${getStatusLabel(r.status)} from ${ddmm(addDays(rangeStart, r.from))}`}
                            />
                          ))}
                          {!sp.contBefore && <span className="edge s" onClick={(ev) => { ev.stopPropagation(); setSelCrew(a.user_id); scrollToFlight(a.user_id); }}>{addDays(rangeStart, sp.aDay).getDate()}</span>}
                          <span className="lbl">{lbl}</span>
                          {!sp.contAfter && <span className="edge e" onClick={(ev) => { ev.stopPropagation(); setSelCrew(a.user_id); scrollToFlight(a.user_id); }}>{addDays(rangeStart, sp.lvDay).getDate()}</span>}
                        </div>
                      );
                    })}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
        <svg className="mv-conn" id="mv-conn" />
        <div className="mv-legrow">
          <div className="mv-legdept">{Object.keys(deptColors).filter((d) => members.some((m) => m.department === d)).map((d) => <span key={d} className="mv-leg"><i style={{ background: tint(deptColors[d], 0.5) }} />{d}</span>)}</div>
        </div>
      </div>
    );
  };

  // move popover
  const openMove = (a, ev) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const hostEl = ev.currentTarget.closest('.mv');
    const host = hostEl.getBoundingClientRect();
    const x = Math.min(rect.left - host.left, hostEl.clientWidth - 260);
    setPop({ a, x: Math.max(0, x), y: rect.bottom - host.top + 8, bedId: a.bed_id, date: '', start: a.start_date || '', end: a.end_date || leaveDateWithin(a) });
  };
  // Same popover, triggered from the handover dialog's "Move anyway" rather
  // than a direct click on a bar — anchor to the bar's own element if it's
  // currently on screen, otherwise fall back to a fixed spot near the top of
  // the chart (still fully usable, just not pinned to a specific bar).
  const openMoveManual = (a) => {
    const hostEl = document.querySelector('.mv');
    const barEl = document.getElementById(`bar-${a.id}`);
    if (hostEl && barEl) {
      const rect = barEl.getBoundingClientRect();
      const host = hostEl.getBoundingClientRect();
      const x = Math.min(rect.left - host.left, hostEl.clientWidth - 260);
      setPop({ a, x: Math.max(0, x), y: rect.bottom - host.top + 8, bedId: a.bed_id, date: '', start: a.start_date || '', end: a.end_date || leaveDateWithin(a) });
    } else {
      setPop({ a, x: 24, y: 24, bedId: a.bed_id, date: '', start: a.start_date || '', end: a.end_date || leaveDateWithin(a) });
    }
  };

  // draw connectors for selected crew after each render — positions are always
  // viewport-relative (getBoundingClientRect), so this is unaffected by the
  // chart's internal horizontal scroll position.
  useEffect(() => {
    const svg = document.getElementById('mv-conn'); if (!svg) return;
    const chart = svg.closest('.mv-chart'); if (!chart) { svg.innerHTML = ''; return; }
    let paths = '';
    if (selCrew) {
      const cr = chart.getBoundingClientRect();
      const list = assigns.filter((a) => a.user_id === selCrew && span(a)).sort((x, y) => (x.start_date < y.start_date ? -1 : 1));
      for (let i = 0; i < list.length - 1; i += 1) {
        const e1 = document.getElementById(`bar-${list[i].id}`), e2 = document.getElementById(`bar-${list[i + 1].id}`);
        if (!e1 || !e2) continue;
        const r1 = e1.getBoundingClientRect(), r2 = e2.getBoundingClientRect();
        const x1 = r1.right - cr.left, y1 = r1.top + r1.height / 2 - cr.top, x2 = r2.left - cr.left, y2 = r2.top + r2.height / 2 - cr.top;
        const col = deptOf(selCrew);
        paths += `<path d="M ${x1} ${y1} C ${x1 + 14} ${y1}, ${x2 - 14} ${y2}, ${x2} ${y2}" fill="none" stroke="${col}" stroke-width="1.7" stroke-dasharray="3 3" opacity="0.9"/><circle cx="${x1}" cy="${y1}" r="2.8" fill="${col}"/><circle cx="${x2}" cy="${y2}" r="2.8" fill="${col}"/>`;
      }
    }
    svg.innerHTML = paths;
  }, [selCrew, assigns, cabins, view]); // eslint-disable-line

  // cabin cards (current snapshot for "today")
  const cards = useMemo(() => {
    const todayStr = dstr(today);
    return cabins.map((c) => ({
      ...c,
      occ: (c.beds || []).map((b) => {
        const a = assigns.find((x) => x.bed_id === b.id && x.start_date <= todayStr && (!x.end_date || x.end_date > todayStr));
        return a ? memberById[a.user_id] : null;
      }),
    }));
  }, [cabins, assigns, memberById]); // eslint-disable-line

  return (
    <div className="mv">
      {(canManage || upcomingTravel.length > 0) && (
        <div className="mv-flights">
          <div className="mv-fhead"><span className="t">Flights &amp; travel</span><span className="ln" />{canManage && <button type="button" className="mv-addtravel" onClick={() => setTravelModal({ entry: null })}><Icon name="Plus" size={13} /> Add travel</button>}</div>
          {upcomingTravel.length === 0 ? <div className="mv-noflt">No upcoming travel logged.</div> : upcomingTravel.map((e) => {
            const m = memberById[e.user_id]; const dir = dirOf(e);
            const eDate = new Date(`${e.start_date}T00:00:00`);
            const legs = [
              { id: `${e.id}-main`, sub: false, transport: e.transport, transportNo: e.transport_no, from: e.from_location, to: e.to_location, departTime: e.depart_time, arriveTime: e.arrive_time, note: e.note },
              ...(legsByEntry[e.id] || []).slice().sort((a, b) => a.seq - b.seq).map((l) => ({ id: l.id, sub: true, transport: l.transport, transportNo: l.transport_no, from: l.from_location, to: l.to_location, departTime: l.depart_time, arriveTime: l.arrive_time, note: null })),
            ];
            return (
              <div key={e.id} id={`flt-${e.id}`} className={`mv-flt${selCrew === e.user_id ? ' sel' : ''}`} onClick={() => selectFromFlight(e.user_id)}>
                <div className="date"><span className="d">{eDate.getDate()}</span><span className="m">{MONTHS[eDate.getMonth()].slice(0, 3)}</span></div>
                <span className="mv-dir"><span className={`dirpill ${dir}`}>{dir === 'dep' ? '↑ Departing' : dir === 'arr' ? '↓ Arriving' : '✈ Travelling'}</span></span>
                <span className="who">{m?.fullName || '—'}</span>
                <div className="legs">
                  {legs.map((l) => (
                    <div className={`leg${l.sub ? ' sub' : ''}`} key={l.id}>
                      <Icon name={TRANS_ICON[l.transport] || (l.sub ? 'Car' : 'Plane')} size={12} />
                      <span className="rt">{[l.from, l.to].filter(Boolean).join(' → ') || (l.note || '—')}</span>
                      {l.transportNo && <span className="no">{l.transportNo}</span>}
                      <span className="tms">
                        {l.departTime && <span className="tm dep"><i>Dep</i>{l.departTime}</span>}
                        {l.arriveTime && <span className="tm arr"><i>Arr</i>{l.arriveTime}</span>}
                      </span>
                    </div>
                  ))}
                </div>
                {canManage && <button type="button" className="mv-editflt" title="Edit travel / add a leg" onClick={(ev) => { ev.stopPropagation(); setTravelModal({ entry: e }); }}><Icon name="Pencil" size={13} /></button>}
              </div>
            );
          })}
        </div>
      )}

      <div className="mv-navrow">
        {view === 'presence' ? (
          <div className="mv-monthnav">
            <button onClick={prevPresenceMonth} aria-label="Previous month">‹</button>
            <span>{MONTHS[calMonth]} {calYear}</span>
            <button onClick={nextPresenceMonth} aria-label="Next month">›</button>
          </div>
        ) : (
          // The month name already appears inline in the scrolling timeline
          // itself (the "JULY 2026" bands), so no separate label here — just
          // the quick-jump controls.
          <div className="mv-scrollnav">
            <button type="button" className="mv-navbtn" onClick={() => scrollByMonth(-1)} aria-label="Scroll back a month"><Icon name="ChevronLeft" size={16} /></button>
            <button type="button" className="mv-today" onClick={scrollToToday}>Today</button>
            <button type="button" className="mv-navbtn" onClick={() => scrollByMonth(1)} aria-label="Scroll forward a month"><Icon name="ChevronRight" size={16} /></button>
          </div>
        )}
        <div className="mv-toggle">
          <button type="button" className={view === 'presence' ? 'on' : ''} onClick={() => setView('presence')}>Presence</button>
          <button type="button" className={view === 'cabins' ? 'on' : ''} onClick={() => setView('cabins')}>Cabins</button>
        </div>
        {loading && <LogoSpinner size={16} />}
        {canManage && (
          <button type="button" className="mv-btn ghost cfg" onClick={() => setConfigOpen(true)}><Icon name="Settings" size={14} /> Configure cabins</button>
        )}
      </div>

      {view === 'presence' ? renderPresence() : renderCabins()}

      {/* Unberthed (cabins view) — a quiet section, not a warning box; still
          draggable straight up into the chart to assign a bed. */}
      {view === 'cabins' && cabins.length > 0 && (
        <div className="mv-unberthed">
          <div className="mv-unb-head">
            <span className="mv-unb-eyebrow">Unberthed{unberthed.length ? ` · ${unberthed.length}` : ''}</span>
            <span className="mv-unb-rule" />
            {unberthed.length === 0 && <span className="mv-unb-ok">Everyone aboard has a bed ✓</span>}
          </div>
          {unberthed.length > 0 && (
            <div className="mv-unb-list">
              {unberthed.map((m) => (
                <span key={m.user_id} className="mv-unb-chip" draggable={canManage} onDragStart={() => setDragKind({ type: 'assign', userId: m.user_id })} title={canManage ? 'Drag up into the chart onto a bed' : ''}>
                  <span className="av" style={{ background: tint(deptOf(m.user_id), 0.34) }}>{initials(m.fullName)}</span>
                  <span className="mv-unb-who">
                    <span className="mv-unb-nm">{m.fullName}{sexOf(m.user_id) && <span className="mv-sex">{sexOf(m.user_id)}</span>}</span>
                    <span className="mv-unb-rl">{[m.roleTitle, m.department].filter(Boolean).join(' · ') || '—'}</span>
                  </span>
                </span>
              ))}
            </div>
          )}

          {/* Away crew — on leave / travelling. Not aboard, but kept on the board
              so you can reserve a bed for their return. */}
          {onLeave.length > 0 && (
            <>
              <div className="mv-unb-head mv-unb-subhead">
                <span className="mv-unb-eyebrow">On leave · {onLeave.length}</span>
                <span className="mv-unb-rule" />
                <span className="mv-unb-hint">Drag onto a bed to plan their return</span>
              </div>
              <div className="mv-unb-list">
                {onLeave.map((m) => (
                  <span key={m.user_id} className="mv-unb-chip is-away" draggable={canManage} onDragStart={() => setDragKind({ type: 'assign', userId: m.user_id })} title={canManage ? 'Drag up into the chart onto a bed to reserve it' : ''}>
                    <span className="av" style={{ background: tint(deptOf(m.user_id), 0.34) }}>{initials(m.fullName)}</span>
                    <span className="mv-unb-who">
                      <span className="mv-unb-nm">{m.fullName}{sexOf(m.user_id) && <span className="mv-sex">{sexOf(m.user_id)}</span>}</span>
                      <span className="mv-unb-rl"><i className="mv-unb-dot" style={{ background: STATUS_COLORS[m.status] }} />{getStatusLabel(m.status)}{m.department ? ` · ${m.department}` : ''}</span>
                    </span>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Cabin cards */}
      {view === 'cabins' && cabins.length > 0 && (
        <div className="mv-cards">
          {cards.map((c) => {
            const sexes = new Set(c.occ.filter(Boolean).map((o) => sexOf(o.user_id)).filter(Boolean));
            const mixed = sexes.has('M') && sexes.has('F');
            return (
              <div key={c.id} className="mv-card">
                <div className="mv-card-top">
                  <div><div className="cn">{c.name}</div>{c.deck && <div className="cd">{c.deck}</div>}</div>
                  <div className="mv-card-meta">{mixed && <span className="mv-mixed" title="This cabin has both male and female crew">⚠ Mixed sex</span>}{c.linen_day && <span className="ln">Linen · {c.linen_day}</span>}</div>
                </div>
                {c.beds.map((b, i) => {
                  const m = c.occ[i];
                  return <div key={b.id} className={`mv-occ${m ? '' : ' free'}`}>{m ? <><span className="av" style={{ background: tint(deptOf(m.user_id), 0.34) }}>{initials(m.fullName)}</span><div><div className="on">{m.fullName}{sexOf(m.user_id) && <span className="mv-sex">{sexOf(m.user_id)}</span>}</div><div className="or">{b.label}</div></div></> : <span className="fr">{b.label} · free</span>}</div>;
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* Move popover */}
      {pop && canManage && (
        <div className="mv-pop" style={{ left: pop.x, top: pop.y }} onClick={(e) => e.stopPropagation()}>
          <h4>{memberById[pop.a.user_id]?.fullName}</h4>
          <div className="sub">{bedRows.find((r) => r.bedId === pop.a.bed_id)?.cabin} · {bedRows.find((r) => r.bedId === pop.a.bed_id)?.label}</div>
          <label>Move to bed</label>
          <select value={pop.bedId} onChange={(e) => setPop({ ...pop, bedId: e.target.value })}>
            {bedRows.map((r) => <option key={r.bedId} value={r.bedId}>{r.cabin} · {r.label}</option>)}
          </select>
          <label>From date</label>
          <input type="date" value={pop.date} min={dstr(rangeStart)} max={dstr(addDays(rangeEnd, -1))} onChange={(e) => setPop({ ...pop, date: e.target.value })} />
          {pop.bedId === pop.a.bed_id && (
            <p className="mv-pop-note">Moving needs a different bed — to change this stay’s dates, use the fields below.</p>
          )}
          <div className="act">
            <button type="button" className="rm" onClick={() => removeStay(pop.a.id)}>Remove</button>
            <button type="button" className="apply" disabled={!pop.date || pop.bedId === pop.a.bed_id} onClick={() => splitMove(pop.a.id, pop.bedId, pop.date)}>Move</button>
          </div>

          {/* The stay's own dates — when they take the bed, and when it frees
              up again. Separate from Move, which is about changing cabin
              mid-tour; these two are what you reach for when someone arrives
              later than planned or leaves the vessel. */}
          <div className="mv-pop-end">
            <label>Arrives — takes the bed on</label>
            <input
              type="date"
              value={pop.start}
              min={dstr(rangeStart)}
              max={pop.a.end_date || dstr(addDays(rangeEnd, -1))}
              onChange={(e) => setPop({ ...pop, start: e.target.value })}
            />
            <div className="act">
              <button
                type="button"
                className="apply"
                disabled={!pop.start || pop.start === pop.a.start_date || (pop.a.end_date && pop.start >= pop.a.end_date)}
                onClick={() => startStay(pop.a.id, pop.start)}
              >
                Set arrival
              </button>
            </div>

            <label>Leaves — bed free from</label>
            <input
              type="date"
              value={pop.end}
              min={pop.a.start_date}
              max={dstr(addDays(rangeEnd, -1))}
              onChange={(e) => setPop({ ...pop, end: e.target.value })}
            />
            {pop.a.end_date && <p className="mv-pop-note">Currently ends {pop.a.end_date}.</p>}
            <div className="act">
              {pop.a.end_date && (
                <button type="button" className="rm" onClick={() => endStay(pop.a.id, null)}>Reopen</button>
              )}
              <button
                type="button"
                className="apply"
                disabled={!pop.end || pop.end <= pop.a.start_date}
                onClick={() => endStay(pop.a.id, pop.end)}
              >
                End stay
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Handover dialog */}
      {handover && (
        <div className="mv-ovl" onMouseDown={handover.reject}>
          <div className="mv-dlg" onMouseDown={(e) => e.stopPropagation()}>
            <h3>Is this a handover?</h3>
            <p><b>{handover.inName}</b> overlaps <b>{handover.outName}</b> in this bed. If it's a handover, {handover.outName} leaves the bed on the changeover date below and {handover.inName} takes over from then.</p>
            <label className="mv-dlg-date">
              <span>Changeover date</span>
              <input type="date" value={hoDate} min={handover.minDate} onChange={(e) => setHoDate(e.target.value)} />
            </label>
            <div className="act">
              <button type="button" className="no" onClick={handover.reject}>No — undo</button>
              <button type="button" className="move" onClick={handover.moveAnyway}>Move anyway</button>
              <button type="button" className="yes" disabled={!hoDate} onClick={() => handover.accept(hoDate)}>Yes, handover</button>
            </div>
          </div>
        </div>
      )}

      <ConfigureCabinsModal isOpen={configOpen} onClose={() => setConfigOpen(false)} tenantId={tenantId} userId={currentUserId} crewAboard={crewAboard} onSaved={() => setRefresh((r) => r + 1)} />

      {travelModal && (
        <TravelModal isOpen onClose={() => setTravelModal(null)} tenantId={tenantId} members={members}
          currentUserId={currentUserId} currentUserName={memberById[currentUserId]?.fullName || ''}
          entry={travelModal.entry} legsForEntry={travelModal.entry ? (legsByEntry[travelModal.entry.id] || []) : []}
          onSaved={() => setRefresh((r) => r + 1)} />
      )}

      {barTip && createPortal(
        <div className="mv-bartip" style={{ left: barTip.x, top: barTip.y }}>
          <div className="nm">{barTip.nm}</div>
          <div className="dt">{barTip.dt}</div>
        </div>,
        document.body,
      )}

      {dayPick && createPortal(
        <div className="mv-daypick-backdrop" onClick={closePick}>
          <div
            className="mv-daypick"
            style={{ left: Math.min(dayPick.x, window.innerWidth - 232), top: Math.min(dayPick.y + 12, window.innerHeight - 320) }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mv-daypick-head">
              <span className="who">{dayPick.fullName || 'Crew'}</span>
              <span className="dt">
                {ddmm(dayPick.startDate)}{dayPick.count > 1 ? `–${ddmm(dayPick.endDate)} · ${dayPick.count} days` : ''}
              </span>
            </div>
            <div className="mv-daypick-opts">
              {CREW_STATUSES.filter((s) => s.value !== 'invited').map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`mv-daypick-opt${dayPick.cur === value ? ' is-cur' : ''}`}
                  disabled={painting}
                  onClick={() => paintRange(dayPick.userId, dayPick.startDate, dayPick.endDate, value)}
                >
                  <i style={{ background: STATUS_COLORS[value] }} />
                  <span>{label}</span>
                  {dayPick.cur === value && <Icon name="Check" size={14} />}
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default CrewMovements;

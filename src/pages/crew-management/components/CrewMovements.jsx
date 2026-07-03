import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
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
const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const dstr = (d) => ymd(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const daysBetween = (a, b) => Math.round((b.getTime() - a.getTime()) / 86400000);
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
const tint = (hex, a) => { const n = parseInt((hex || '#7A6F8C').slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
const initials = (name) => (name || '?').split(' ').map((x) => x[0]).slice(0, 2).join('');

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
  const [flashId, setFlashId] = useState(null);   // bar to pulse after "Move anyway"
  const [focusLabel, setFocusLabel] = useState('');

  const memberById = useMemo(() => Object.fromEntries(members.map((m) => [m.user_id, m])), [members]);
  const memberIds = useMemo(() => members.map((m) => m.user_id).filter(Boolean), [members]);
  const crewAboard = useMemo(() => members.filter((m) => ABOARD.has(m.status)).length, [members]);
  const deptOf = (uid) => deptColors[memberById[uid]?.department] || '#7A6F8C';

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
  }, [tenantId, memberIds.join(',')]);

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
    return members.filter((m) => ABOARD.has(m.status) && !berthed.has(m.user_id));
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
    setHandover({
      inName: memberById[moved.user_id]?.fullName, outName: memberById[other.user_id]?.fullName,
      onDate: late.start_date, earlyId: early.id,
      accept: async () => { setHandover(null); await updateAssignment(early.id, { end_date: late.start_date }); await reload(); },
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

  // ── presence rendering (plain single-month grid, unchanged) ─────────────────
  const renderPresence = () => (
    <div className="mv-grid">
      <div className="mv-row">
        <div className="mv-name" />
        {Array.from({ length: totalDays }, (_, i) => <div key={i} className={`mv-dnum${(i + 1) % 5 === 0 ? ' d5' : ''}`}>{i + 1}</div>)}
      </div>
      {members.length === 0 ? <p className="mv-empty">No crew to display.</p> : members.map((m) => {
        const periods = buildStatusPeriods(historyByUser[m.user_id] || []);
        return (
          <div key={m.user_id} className="mv-row">
            <div className="mv-name" title={m.fullName}>{m.fullName || '—'}</div>
            {Array.from({ length: totalDays }, (_, i) => {
              const st = getStatusForDay(periods, new Date(calYear, calMonth, i + 1));
              return <div key={i} className="mv-cell" title={st ? `${m.fullName}: ${getStatusLabel(st)}` : ''} style={st ? { background: STATUS_COLORS[st] } : undefined} />;
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
                <div className="mv-namerow">{bd.label}</div>
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
                  <div className="mv-track" style={{ width: viewDays * DAY_W }} onDragOver={(e) => { if (!canManage) return; e.preventDefault(); e.currentTarget.classList.add('drop'); }} onDragLeave={(e) => e.currentTarget.classList.remove('drop')}
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
                      const lbl = w > 90 ? nm : initials(nm); const dim = selCrew && selCrew !== a.user_id;
                      return (
                        <div key={a.id} className={`mv-bar${!sp.contBefore ? ' j' : ''}${!sp.contAfter ? ' l' : ''}${selCrew === a.user_id ? ' sel' : ''}${flashId === a.id ? ' flash' : ''}`} id={`bar-${a.id}`}
                          draggable={canManage} onDragStart={() => canManage && setDragKind({ type: 'bar', assignId: a.id })}
                          onClick={(e) => { e.stopPropagation(); setSelCrew(a.user_id); if (canManage) openMove(a, e); }}
                          style={{ left: leftPx(sp.aDay), width: w, background: bg, opacity: dim ? 0.4 : 1 }} title={`${nm} — ${a.start_date}${a.end_date ? ` → ${a.end_date}` : ' (open)'}`}>
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
    setPop({ a, x: Math.max(0, x), y: rect.bottom - host.top + 8, bedId: a.bed_id, date: '' });
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
      setPop({ a, x: Math.max(0, x), y: rect.bottom - host.top + 8, bedId: a.bed_id, date: '' });
    } else {
      setPop({ a, x: 24, y: 24, bedId: a.bed_id, date: '' });
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
      <div className="mv-head">
        <div className="mv-title"><span className="mv-eyebrow">◆</span> Movements</div>
      </div>

      {(canManage || upcomingTravel.length > 0) && (
        <div className="mv-flights">
          <div className="mv-fhead"><span className="t">Flights &amp; travel</span><span className="ln" />{canManage && <button type="button" className="mv-addtravel" onClick={() => setTravelModal({ entry: null })}><Icon name="Plus" size={13} /> Add travel</button>}</div>
          {upcomingTravel.length === 0 ? <div className="mv-noflt">No upcoming travel logged.</div> : upcomingTravel.map((e) => {
            const m = memberById[e.user_id]; const dir = dirOf(e);
            const eDate = new Date(`${e.start_date}T00:00:00`);
            const extra = (legsByEntry[e.id] || []).slice().sort((a, b) => a.seq - b.seq);
            return (
              <div key={e.id} id={`flt-${e.id}`} className={`mv-flt${selCrew === e.user_id ? ' sel' : ''}`} onClick={() => selectFromFlight(e.user_id)}>
                <div className="date"><span className="d">{eDate.getDate()}</span><span className="m">{MONTHS[eDate.getMonth()].slice(0, 3)}</span></div>
                <span className="mv-dir"><span className={`dirpill ${dir}`}>{dir === 'dep' ? '↑ Departing' : dir === 'arr' ? '↓ Arriving' : '✈ Travelling'}</span></span>
                <span className="who">{m?.fullName || '—'}</span>
                <div className="legs">
                  <div className="leg"><Icon name={TRANS_ICON[e.transport] || 'Plane'} size={12} /> <span className="rt">{[e.from_location, e.to_location].filter(Boolean).join(' → ') || (e.note || '—')}</span>{e.transport_no && <span className="no">{e.transport_no}</span>}{(e.arrive_time || e.depart_time) && <span className="tm">{e.arrive_time || e.depart_time}</span>}</div>
                  {extra.map((l) => (
                    <div className="leg sub" key={l.id}><Icon name={TRANS_ICON[l.transport] || 'Car'} size={12} /> <span className="rt">{[l.from_location, l.to_location].filter(Boolean).join(' → ') || '—'}</span>{l.transport_no && <span className="no">{l.transport_no}</span>}{(l.arrive_time || l.depart_time) && <span className="tm">{l.arrive_time || l.depart_time}</span>}</div>
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
          <div className="act">
            <button type="button" className="rm" onClick={() => removeStay(pop.a.id)}>Remove</button>
            <button type="button" className="apply" disabled={!pop.date} onClick={() => splitMove(pop.a.id, pop.bedId, pop.date)}>Move</button>
          </div>
        </div>
      )}

      {/* Handover dialog */}
      {handover && (
        <div className="mv-ovl" onMouseDown={handover.reject}>
          <div className="mv-dlg" onMouseDown={(e) => e.stopPropagation()}>
            <h3>Is this a handover?</h3>
            <p><b>{handover.inName}</b> overlaps <b>{handover.outName}</b> in this bed. If it's a handover, {handover.outName} leaves the bed on the {new Date(`${handover.onDate}T00:00:00`).getDate()}th and {handover.inName} takes over.</p>
            <div className="act">
              <button type="button" className="no" onClick={handover.reject}>No — undo</button>
              <button type="button" className="move" onClick={handover.moveAnyway}>Move anyway</button>
              <button type="button" className="yes" onClick={handover.accept}>Yes, handover</button>
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
    </div>
  );
};

export default CrewMovements;

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import { buildStatusPeriods, getStatusForDay, getStatusLabel, CREW_STATUSES } from '../../../utils/crewStatus';
import { fetchCabins, fetchAssignments, createAssignment, updateAssignment, deleteAssignment } from '../utils/vesselCabins';
import ConfigureCabinsModal from './ConfigureCabinsModal';
import './crew-movements.css';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const STATUS_COLORS = { active: '#7FCBA6', on_leave: '#E6C079', rotational_leave: '#C3AEEA', medical_leave: '#E8A29A', training_leave: '#9DBCF0', travelling: '#7FD3CA', invited: '#D8D6CF' };
const ABOARD = new Set(['active']); // crew that need a bed this month
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const tint = (hex, a) => { const n = parseInt((hex || '#7A6F8C').slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
const initials = (name) => (name || '?').split(' ').map((x) => x[0]).slice(0, 2).join('');

const CrewMovements = ({ members = [], tenantId, currentUserId, canManage, canNavigate }) => {
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [view, setView] = useState('presence');
  const [historyByUser, setHistoryByUser] = useState({});
  const [cabins, setCabins] = useState([]);
  const [assigns, setAssigns] = useState([]);
  const [travel, setTravel] = useState([]);
  const [deptColors, setDeptColors] = useState({});
  const [sexMap, setSexMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [configOpen, setConfigOpen] = useState(false);
  const [selCrew, setSelCrew] = useState(null);
  const [dragKind, setDragKind] = useState(null); // {type:'assign'|'bar', ...}
  const [pop, setPop] = useState(null);           // move popover
  const [handover, setHandover] = useState(null); // conflict dialog

  const totalDays = daysIn(calYear, calMonth);
  const memberById = useMemo(() => Object.fromEntries(members.map((m) => [m.user_id, m])), [members]);
  const memberIds = useMemo(() => members.map((m) => m.user_id).filter(Boolean), [members]);
  const crewAboard = useMemo(() => members.filter((m) => ABOARD.has(m.status)).length, [members]);
  const deptOf = (uid) => deptColors[memberById[uid]?.department] || '#7A6F8C';

  const AWAY = new Set(['on_leave', 'rotational_leave', 'medical_leave', 'training_leave']);
  const TRANS_ICON = { Flight: 'Plane', Train: 'TrainFront', Ferry: 'Ship', Car: 'Car', Other: 'MapPin' };
  const dirOf = (e) => (e.kind === 'active' ? 'arr' : AWAY.has(e.kind) ? 'dep' : 'transit');
  const monthTravel = useMemo(() => {
    const mStart = ymd(calYear, calMonth, 1), mEnd = ymd(calYear, calMonth, totalDays);
    return travel
      .filter((e) => (e.transport || e.from_location || e.to_location) && (e.start_date || '').slice(0, 10) >= mStart && (e.start_date || '').slice(0, 10) <= mEnd)
      .sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  }, [travel, calYear, calMonth, totalDays]);

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
    const [cabs, asg, dep, trv, sx] = await Promise.all([
      fetchCabins(tenantId), fetchAssignments(tenantId),
      supabase.from('departments').select('name, color'),
      supabase.from('crew_calendar_entries').select('*').eq('tenant_id', tenantId),
      memberIds.length ? supabase.from('crew_personal_details').select('user_id, sex').in('user_id', memberIds) : Promise.resolve({ data: [] }),
    ]);
    setCabins(cabs);
    setAssigns(asg);
    setDeptColors(Object.fromEntries((dep.data || []).map((d) => [d.name, d.color])));
    setTravel(trv.data || []);
    setSexMap(Object.fromEntries((sx.data || []).map((r) => [r.user_id, r.sex === 'Male' ? 'M' : r.sex === 'Female' ? 'F' : ''])));
    setLoading(false);
  }, [tenantId, memberIds]);
  const sexOf = (uid) => sexMap[uid] || '';
  useEffect(() => { loadCabins(); }, [loadCabins, refresh]);

  const prevM = () => { if (calMonth === 0) { setCalYear((y) => y - 1); setCalMonth(11); } else setCalMonth((m) => m - 1); };
  const nextM = () => { if (calMonth === 11) { setCalYear((y) => y + 1); setCalMonth(0); } else setCalMonth((m) => m + 1); };

  // ── flat bed rows (grouped by cabin) ─────────────────────────────────────────
  const bedRows = useMemo(() => {
    const rows = [];
    cabins.forEach((c) => (c.beds || []).forEach((b) => rows.push({ bedId: b.id, cabinId: c.id, cabin: c.name, deck: c.deck, label: b.label })));
    return rows;
  }, [cabins]);

  // ── map an assignment onto the viewed month → {aDay, lvDay, contBefore, contAfter} ─
  const span = useCallback((a) => {
    const s = new Date(`${a.start_date}T00:00:00`);
    const e = a.end_date ? new Date(`${a.end_date}T00:00:00`) : null;
    const mStart = new Date(calYear, calMonth, 1), mEnd = new Date(calYear, calMonth, totalDays);
    if (s > mEnd) return null;
    if (e && e <= mStart) return null;
    const contBefore = s < mStart;
    const aDay = contBefore ? 1 : s.getDate();
    let lvDay, contAfter = false;
    if (!e) { lvDay = totalDays + 1; contAfter = true; }
    else if (e.getFullYear() === calYear && e.getMonth() === calMonth) lvDay = e.getDate();
    else { lvDay = totalDays + 1; contAfter = true; }
    if (lvDay <= aDay) return null;
    return { aDay, lvDay, contBefore, contAfter };
  }, [calYear, calMonth, totalDays]);

  const L = (x) => ((x - 1) / totalDays) * 100;

  // Cabins where M and F crew overlap on any night this month → flag for review
  // (couples aside, you usually don't want mixed-sex sharing).
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

  const promptHandover = (moved, fresh) => {
    const other = overlapsOnBed(fresh, moved);
    if (!other) return false;
    const early = other.start_date <= moved.start_date ? other : moved;
    const late = other.start_date <= moved.start_date ? moved : other;
    setHandover({
      inName: memberById[moved.user_id]?.fullName, outName: memberById[other.user_id]?.fullName,
      onDate: late.start_date, earlyId: early.id,
      accept: async () => { setHandover(null); await updateAssignment(early.id, { end_date: late.start_date }); await reload(); },
      reject: async () => { setHandover(null); await reload(); },
    });
    return true;
  };

  // ── actions ──────────────────────────────────────────────────────────────────
  const assignToBed = async (bedId, userId) => {
    // default a new stay to the whole viewed month, open-ended forward
    const startD = ymd(calYear, calMonth, 1);
    const row = await createAssignment({ tenantId, bedId, userId, startDate: startD, endDate: null, createdBy: currentUserId });
    setSelCrew(userId);
    const fresh = await fetchAssignments(tenantId);
    if (!promptHandover({ ...row }, fresh)) await reload();
  };
  const moveWholeBar = async (assignId, bedId) => {
    const a = assigns.find((x) => x.id === assignId); if (!a || a.bed_id === bedId) return;
    await updateAssignment(assignId, { bed_id: bedId });
    setSelCrew(a.user_id);
    const fresh = await fetchAssignments(tenantId);
    const moved = fresh.find((x) => x.id === assignId);
    if (!promptHandover(moved, fresh)) await reload();
  };
  const splitMove = async (assignId, bedId, dateStr) => {
    const a = assigns.find((x) => x.id === assignId); if (!a) return;
    const origEnd = a.end_date;
    await updateAssignment(assignId, { end_date: dateStr });
    const row = await createAssignment({ tenantId, bedId, userId: a.user_id, startDate: dateStr, endDate: origEnd, createdBy: currentUserId });
    setPop(null); setSelCrew(a.user_id);
    const fresh = await fetchAssignments(tenantId);
    if (!promptHandover({ ...row }, fresh)) await reload();
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
      if (a) document.getElementById(`bar-${a.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  };
  // Bar → flight: scroll the matching flight row into view (highlight is via selCrew).
  const scrollToFlight = (uid) => {
    const e = monthTravel.find((x) => x.user_id === uid);
    if (e) document.getElementById(`flt-${e.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // ── presence rendering ────────────────────────────────────────────────────────
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
    return (
      <div className="mv-chart" onClick={() => { setSelCrew(null); setPop(null); }}>
        <div className="mv-row">
          <div className="mv-name" />
          <div className="mv-htrack">{Array.from({ length: totalDays }, (_, i) => <span key={i} className={`mv-dtick${(i + 1) % 5 === 0 ? ' d5' : ''}`} style={{ left: `${L(i + 1)}%`, transform: i === 0 ? 'none' : 'translateX(-50%)' }}>{i + 1}</span>)}</div>
        </div>
        {bedRows.map((bd) => {
          const head = bd.cabin !== lastCabin ? (lastCabin = bd.cabin, <div key={`g-${bd.bedId}`} className="mv-cbngroup">{bd.cabin}{bd.deck ? ` · ${bd.deck.replace(' deck', '')}` : ''}<span className="gl" />{cabinMixed[bd.cabinId] && <span className="mv-mixed" title="Male and female crew share this cabin this month">⚠ Mixed sex</span>}</div>) : null;
          const rowAssigns = assigns.filter((a) => a.bed_id === bd.bedId).map((a) => ({ a, sp: span(a) })).filter((x) => x.sp);
          // gaps
          const covered = new Array(totalDays + 2).fill(false);
          rowAssigns.forEach(({ sp }) => { for (let d = sp.aDay; d < sp.lvDay; d += 1) covered[d] = true; });
          const gaps = [];
          let g = 1; while (g <= totalDays) { if (!covered[g]) { let e = g; while (e + 1 <= totalDays && !covered[e + 1]) e += 1; gaps.push([g, e]); g = e + 1; } else g += 1; }
          return (
            <React.Fragment key={bd.bedId}>
              {head}
              <div className="mv-row">
                <div className="mv-bedname">{bd.label}</div>
                <div className="mv-track" onDragOver={(e) => { if (!canManage) return; e.preventDefault(); e.currentTarget.classList.add('drop'); }} onDragLeave={(e) => e.currentTarget.classList.remove('drop')}
                  onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drop'); if (!canManage) return; const dk = dragKind; setDragKind(null); if (!dk) return; if (dk.type === 'assign') assignToBed(bd.bedId, dk.userId); else moveWholeBar(dk.assignId, bd.bedId); }}>
                  <div className="mv-gridlines">{Array.from({ length: totalDays }, (_, i) => <i key={i} className={(i + 1) % 5 === 0 ? 'v5' : ''} />)}</div>
                  {gaps.map(([a, b]) => { const nights = b - a + 1, w = nights / totalDays * 100; return <div key={`gap-${a}`} className={`mv-gap${nights === 1 ? ' one' : ''}`} style={{ left: `${L(a)}%`, width: `${w}%` }} title={`Free — ${nights} night${nights > 1 ? 's' : ''}`}>{w > 8 ? `${nights} night${nights > 1 ? 's' : ''} free` : w > 3 ? `${nights}n` : ''}</div>; })}
                  {rowAssigns.map(({ a, sp }) => {
                    const m = memberById[a.user_id]; const w = (sp.lvDay - sp.aDay) / totalDays * 100;
                    const bg = tint(deptOf(a.user_id), 0.34); const nm = m?.fullName || '—';
                    const lbl = w > 12 ? nm : initials(nm); const dim = selCrew && selCrew !== a.user_id;
                    return (
                      <div key={a.id} className={`mv-bar${!sp.contBefore ? ' j' : ''}${!sp.contAfter ? ' l' : ''}${selCrew === a.user_id ? ' sel' : ''}`} id={`bar-${a.id}`}
                        draggable={canManage} onDragStart={() => canManage && setDragKind({ type: 'bar', assignId: a.id })}
                        onClick={(e) => { e.stopPropagation(); setSelCrew(a.user_id); if (canManage) openMove(a, e); }}
                        style={{ left: `${L(sp.aDay)}%`, width: `${w}%`, background: bg, opacity: dim ? 0.4 : 1 }} title={`${nm} — ${a.start_date}${a.end_date ? ` → ${a.end_date}` : ' (open)'}`}>
                        {!sp.contBefore && <span className="edge s" onClick={(ev) => { ev.stopPropagation(); setSelCrew(a.user_id); scrollToFlight(a.user_id); }}>{sp.aDay}</span>}
                        <span className="lbl">{lbl}</span>
                        {!sp.contAfter && <span className="edge e" onClick={(ev) => { ev.stopPropagation(); setSelCrew(a.user_id); scrollToFlight(a.user_id); }}>{sp.lvDay}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </React.Fragment>
          );
        })}
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

  // draw connectors for selected crew after each render
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
  }, [selCrew, assigns, cabins, view, calMonth, calYear]); // eslint-disable-line

  // cabin cards (current snapshot for "today")
  const cards = useMemo(() => {
    const todayStr = ymd(today.getFullYear(), today.getMonth(), today.getDate());
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
        <div className="mv-toggle">
          <button type="button" className={view === 'presence' ? 'on' : ''} onClick={() => setView('presence')}>Presence</button>
          <button type="button" className={view === 'cabins' ? 'on' : ''} onClick={() => setView('cabins')}>Cabins</button>
        </div>
        {canManage && <button type="button" className="mv-btn ghost mv-config" onClick={() => setConfigOpen(true)}><Icon name="Settings" size={14} /> Configure cabins</button>}
      </div>

      {monthTravel.length > 0 && (
        <div className="mv-flights">
          <div className="mv-fhead"><span className="t">Flights &amp; travel</span><span className="ln" /></div>
          {monthTravel.map((e) => {
            const m = memberById[e.user_id]; const dir = dirOf(e);
            const day = new Date(`${e.start_date}T00:00:00`).getDate();
            const route = [e.from_location, e.to_location].filter(Boolean).join(' → ');
            const time = e.arrive_time || e.depart_time || '';
            return (
              <div key={e.id} id={`flt-${e.id}`} className={`mv-flt${selCrew === e.user_id ? ' sel' : ''}`} onClick={() => selectFromFlight(e.user_id)}>
                <div className="date"><span className="d">{day}</span><span className="m">{MONTHS[calMonth].slice(0, 3)}</span></div>
                <span className={`dirpill ${dir}`}>{dir === 'dep' ? '↑ Departing' : dir === 'arr' ? '↓ Arriving' : '✈ Travelling'}</span>
                <span className="who">{m?.fullName || '—'}</span>
                <span className="route"><Icon name={TRANS_ICON[e.transport] || 'Plane'} size={13} /> {route || (e.note || '—')}</span>
                {e.transport_no && <span className="fno">{e.transport_no}</span>}
                {time && <span className="time">{time}</span>}
              </div>
            );
          })}
        </div>
      )}

      <div className="mv-navrow">
        <div className="mv-monthnav"><button onClick={prevM} aria-label="Previous month">‹</button><span>{MONTHS[calMonth]} {calYear}</span><button onClick={nextM} aria-label="Next month">›</button></div>
        {loading && <LogoSpinner size={16} />}
      </div>

      {view === 'presence' ? renderPresence() : renderCabins()}

      {/* Unberthed tray (cabins view) */}
      {view === 'cabins' && cabins.length > 0 && (
        <div className="mv-tray">
          <span className="mv-traylbl">Unberthed{unberthed.length ? ` · ${unberthed.length}` : ''}</span>
          {unberthed.length === 0 ? <span className="mv-trayok">Everyone aboard has a bed ✓</span>
            : unberthed.map((m) => (
              <span key={m.user_id} className="mv-chip" draggable={canManage} onDragStart={() => setDragKind({ type: 'assign', userId: m.user_id })} title={canManage ? 'Drag onto a bed' : ''}>
                <span className="av" style={{ background: tint(deptOf(m.user_id), 0.34) }}>{initials(m.fullName)}</span>{m.fullName}{sexOf(m.user_id) && <span className="mv-sex">{sexOf(m.user_id)}</span>}
              </span>
            ))}
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
          <select value={pop.date} onChange={(e) => setPop({ ...pop, date: e.target.value })}>
            <option value="">choose…</option>
            {Array.from({ length: totalDays }, (_, i) => i + 1).map((d) => <option key={d} value={ymd(calYear, calMonth, d)}>{d} {MONTHS[calMonth].slice(0, 3)}</option>)}
          </select>
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
            <div className="act"><button type="button" className="no" onClick={handover.reject}>No — undo</button><button type="button" className="yes" onClick={handover.accept}>Yes, handover</button></div>
          </div>
        </div>
      )}

      <ConfigureCabinsModal isOpen={configOpen} onClose={() => setConfigOpen(false)} tenantId={tenantId} userId={currentUserId} crewAboard={crewAboard} onSaved={() => setRefresh((r) => r + 1)} />
    </div>
  );
};

export default CrewMovements;

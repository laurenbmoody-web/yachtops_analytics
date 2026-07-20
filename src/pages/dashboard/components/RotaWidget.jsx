import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabaseClient';
import { useCurrentRota } from '../../crew-rota/useCurrentRota';
import { assessMlc, ON_DUTY_TYPES, MLC_DAILY_REST_MIN } from '../../crew-rota/restHours';
import TimeWheel from '../../../components/editorial/TimeWheel';
import { upsertWorkEntryDay } from '../../crew-profile/utils/horWorkEntries';
import './rota-widget.css';

// Rota widget — role-scoped rest view.
//   • Everyone: their own On ⟶ Off today + confirm, rest standing.
//   • Crew/HOD: a 4-day "coming up" strip + today's vessel watch.
//   • Chief: their department's per-crew rest-compliance grid.
//   • Command: rest compliance rolled up by department.
// Compliance is computed live from assessMlc (MLC 2006 A2.3). The vessel-watch
// roster is placeholder data — the watch-schedule model isn't built yet.

const pad2 = (n) => String(n).padStart(2, '0');
const toYmd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); const dt = new Date(y, m - 1, d + n); return toYmd(dt); };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Monday of the week containing `date`.
function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return d;
}

const hhmm = (t) => (t ? String(t).slice(0, 5) : null);

// A member's on-duty span for a date: earliest start → latest end (HH:MM),
// plus rough hours on. Null when they have no on-duty shift (a rest day).
function spanForDay(shifts, date) {
  const onDuty = shifts.filter((s) => s.date === date && ON_DUTY_TYPES.has(s.shiftType));
  if (onDuty.length === 0) return null;
  let start = null; let end = null;
  for (const s of onDuty) {
    const a = hhmm(s.startTime); const b = hhmm(s.endTime);
    if (a && (start === null || a < start)) start = a;
    if (b && (end === null || b > end)) end = b;
  }
  if (!start || !end) return null;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let dur = (eh + em / 60) - (sh + sm / 60);
  if (dur <= 0) dur += 24; // overnight
  return { start, end, hours: Math.round(dur) };
}

// Per-day compliance for one member, matching RestLogView's cell colouring
// (rotaHorExportData.computeCell): a day with no on-duty shift is a rest day →
// compliant; rest-in-24h < 10h → breach; [10h, 11h) → marginal; else compliant.
// weekShifts is the trailing 7-day window [D-6, D] the daily-rest test needs.
function dayStatus(shifts, date) {
  const dayShifts = shifts.filter((s) => s.date === date);
  const onDuty = dayShifts.filter((s) => ON_DUTY_TYPES.has(s.shiftType));
  if (onDuty.length === 0) return 'compliant';
  const weekShifts = shifts.filter((s) => s.date > addDays(date, -7) && s.date <= date);
  const { rest24h } = assessMlc({ dayShifts, weekShifts });
  if (rest24h != null && rest24h < MLC_DAILY_REST_MIN) return 'breach';
  if (rest24h != null && rest24h < MLC_DAILY_REST_MIN + 1) return 'marginal';
  return 'compliant';
}
const RANK = { breach: 2, marginal: 1, compliant: 0 };
const worse = (a, b) => (RANK[a] >= RANK[b] ? a : b);

// HH:MM → 30-min block index (0–47). A range [start, end) becomes the block
// indices to log; end <= start wraps past midnight, so we run to the end of the
// day (the post-midnight part belongs to the next day, handled by the HOR page).
const toIdx = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 2 + (m >= 30 ? 1 : 0); };
function buildSegments(start, end, type) {
  const s = toIdx(start); let e = toIdx(end); if (e <= s) e = 48;
  const segs = []; const types = {};
  for (let i = s; i < e && i < 48; i += 1) { segs.push(i); types[i] = type; }
  return { segs, types };
}
const blockToHHMM = (b) => `${pad2(Math.floor(b / 2))}:${pad2((b % 2) * 30)}`;
// A logged HOR day (hor_work_entries.work_segments) → a single on-duty span so
// it can slot into the same rest math + hero the planned shifts use.
function entryToShift(date, segments, types) {
  if (!Array.isArray(segments) || segments.length === 0) return null; // logged rest day
  const min = Math.min(...segments); const max = Math.max(...segments);
  const type = (types && Object.values(types)[0]) || 'duty';
  return { memberId: null, date, startTime: blockToHHMM(min), endTime: blockToHHMM(max + 1), shiftType: type, logged: true };
}

const ArrowSvg = ({ w = 40 }) => (
  <svg width={w} height="10" viewBox="0 0 40 10" fill="none" aria-hidden="true">
    <path d="M0 5h34m0 0-5-4m5 4-5 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const RotaWidget = () => {
  const navigate = useNavigate();
  const { user, activeTenantId, tenantRole } = useAuth();
  const { rota, loading: rotaLoading, error: rotaError } = useCurrentRota();

  const [members, setMembers] = useState([]);
  const [shiftsByMember, setShiftsByMember] = useState(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // The current user's own logged HOR actuals (date → {segments, types}).
  const [myEntries, setMyEntries] = useState(() => new Map());
  // The editable On/Off the wheels bind to; saved to the HOR log on Confirm.
  const [editStart, setEditStart] = useState('08:00');
  const [editEnd, setEditEnd] = useState('12:00');
  const [logRest, setLogRest] = useState(false); // reveal wheels on a rest day
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(false);

  const tier = (tenantRole || user?.permission_tier || '').toUpperCase();
  const view = tier === 'COMMAND' ? 'command' : tier === 'CHIEF' ? 'chief' : 'crew';

  // Display week (Mon–Sun of the current week) + the trailing window each day
  // needs for its 7-day rest test.
  const todayStr = toYmd(new Date());
  const weekMonStr = toYmd(mondayOf(new Date()));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekMonStr, i)), [weekMonStr]);
  const loadStart = addDays(weekMonStr, -6);
  const loadEnd = addDays(weekMonStr, 6);

  const load = useCallback(async () => {
    if (!activeTenantId || !rota?.id) { setLoading(false); return; }
    setLoading(true); setError(false);
    try {
      const [membersRes, shiftsRes, entriesRes] = await Promise.all([
        supabase.from('tenant_members')
          .select('id, user_id, display_name, permission_tier, department_id, departments ( name )')
          .eq('tenant_id', activeTenantId).eq('active', true),
        supabase.from('rota_shifts')
          .select('member_id, shift_date, start_time, end_time, shift_type, sub_type')
          .eq('tenant_id', activeTenantId).eq('rota_id', rota.id)
          .gte('shift_date', loadStart).lte('shift_date', loadEnd),
        // The current user's own logged HOR actuals in the window.
        user?.id
          ? supabase.from('hor_work_entries')
            .select('entry_date, work_segments, segment_types')
            .eq('tenant_id', activeTenantId).eq('subject_user_id', user.id)
            .gte('entry_date', loadStart).lte('entry_date', loadEnd)
          : Promise.resolve({ data: [] }),
      ]);
      if (membersRes.error) throw membersRes.error;
      if (shiftsRes.error) throw shiftsRes.error;

      const em = new Map();
      for (const e of (entriesRes.data || [])) em.set(e.entry_date, { segments: e.work_segments || [], types: e.segment_types || {} });
      setMyEntries(em);

      const mm = (membersRes.data || []).map((m) => ({
        id: m.id,
        userId: m.user_id,
        name: m.display_name || 'Unknown',
        departmentId: m.department_id || null,
        department: m.departments?.name || '—',
        tier: (m.permission_tier || '').toUpperCase(),
      }));
      const byMember = new Map();
      for (const s of (shiftsRes.data || [])) {
        const row = { memberId: s.member_id, date: s.shift_date, startTime: s.start_time, endTime: s.end_time, shiftType: s.shift_type, subType: s.sub_type };
        if (!byMember.has(s.member_id)) byMember.set(s.member_id, []);
        byMember.get(s.member_id).push(row);
      }
      setMembers(mm);
      setShiftsByMember(byMember);
    } catch (err) {
      console.error('[RotaWidget] fetch error:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [activeTenantId, rota?.id, loadStart, loadEnd]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  // ── The current user's own row ───────────────────────────────
  const me = useMemo(() => members.find((m) => m.userId && m.userId === user?.id) || null, [members, user?.id]);
  const myShifts = useMemo(() => (me && shiftsByMember.get(me.id)) || [], [me, shiftsByMember]);
  // Logged HOR actuals override the planned shift on any day the user has
  // confirmed — the same "logged is truth" rule the rota page uses. This is
  // what makes a confirmed change actually show here.
  const myShiftsMerged = useMemo(() => {
    const loggedDates = new Set(myEntries.keys());
    const base = myShifts.filter((s) => !loggedDates.has(s.date));
    const logged = [];
    for (const [date, e] of myEntries) { const sh = entryToShift(date, e.segments, e.types); if (sh) logged.push(sh); }
    return base.concat(logged);
  }, [myShifts, myEntries]);

  const myToday = spanForDay(myShiftsMerged, todayStr);
  const loggedToday = myEntries.has(todayStr);
  const myTodayType = myShifts.find((s) => s.date === todayStr && ON_DUTY_TYPES.has(s.shiftType))?.shiftType || 'duty';
  const tmrwStr = addDays(todayStr, 1);
  const myTomorrow = spanForDay(myShiftsMerged, tmrwStr);
  const tmrwDt = new Date(`${tmrwStr}T00:00:00`);
  const tomorrowLabel = `${WD[tmrwDt.getDay()]} ${tmrwDt.getDate()}`;
  const myReport = useMemo(() => assessMlc({
    dayShifts: myShiftsMerged.filter((s) => s.date === todayStr),
    weekShifts: myShiftsMerged.filter((s) => s.date > addDays(todayStr, -7) && s.date <= todayStr),
  }), [myShiftsMerged, todayStr]);
  const myWeekRest = myReport.pastWeekHours != null ? Math.round(myReport.pastWeekHours) : null;
  const myBreach = myReport.anyBreach;

  // The wheels track the logged (or planned) On/Off; re-sync when data changes
  // and the user isn't mid-scroll (they can always re-open).
  const heroStart = myToday?.start; const heroEnd = myToday?.end;
  useEffect(() => {
    if (heroStart) setEditStart(heroStart);
    if (heroEnd) setEditEnd(heroEnd);
  }, [heroStart, heroEnd]);
  // Live duration between the wheels (updates as they scroll).
  const editHours = useMemo(() => {
    const [sh, sm] = editStart.split(':').map(Number);
    const [eh, em] = editEnd.split(':').map(Number);
    let d = (eh + em / 60) - (sh + sm / 60); if (d <= 0) d += 24;
    return Math.round(d);
  }, [editStart, editEnd]);

  const saveHours = async () => {
    setSaving(true); setSaveErr(false);
    try {
      const { segs, types } = buildSegments(editStart, editEnd, myTodayType);
      await upsertWorkEntryDay({ tenantId: activeTenantId, subjectUserId: user?.id, date: todayStr, workSegments: segs, segmentTypes: types });
      setLogRest(false);
      await load();
    } catch (err) {
      console.error('[RotaWidget] confirm hours failed:', err);
      setSaveErr(true);
    } finally {
      setSaving(false);
    }
  };

  // Crew "coming up" — next 4 days.
  const comingUp = useMemo(() => Array.from({ length: 4 }, (_, i) => {
    const date = addDays(todayStr, i + 1);
    const dt = new Date(`${date}T00:00:00`);
    return { date, wd: WD[dt.getDay()], dn: dt.getDate(), span: spanForDay(myShiftsMerged, date) };
  }), [myShiftsMerged, todayStr]);

  // ── Compliance grids ─────────────────────────────────────────
  const chiefMembers = useMemo(() => (
    me?.departmentId ? members.filter((m) => m.departmentId === me.departmentId) : []
  ), [members, me?.departmentId]);

  const chiefRows = useMemo(() => chiefMembers.map((m) => {
    const sh = shiftsByMember.get(m.id) || [];
    const cells = days.map((d) => dayStatus(sh, d));
    return { name: m.name, cells, breaches: cells.filter((c) => c === 'breach').length };
  }).sort((a, b) => b.breaches - a.breaches), [chiefMembers, shiftsByMember, days]);

  const deptRows = useMemo(() => {
    // A department is "in use" because it has active crew — inviting a crew
    // member into a department (e.g. a pilot → Aviation) is what puts it on
    // this list. Crew with no department don't form a department row.
    const byDept = new Map();
    for (const m of members) {
      if (!m.departmentId) continue;
      if (!byDept.has(m.departmentId)) byDept.set(m.departmentId, { name: m.department, memberIds: [] });
      byDept.get(m.departmentId).memberIds.push(m.id);
    }
    return [...byDept.values()].map((dep) => {
      const cells = days.map((d) => dep.memberIds.reduce((acc, id) => worse(acc, dayStatus(shiftsByMember.get(id) || [], d)), 'compliant'));
      return { name: dep.name, cells, breaches: cells.filter((c) => c === 'breach').length };
    }).sort((a, b) => b.breaches - a.breaches);
  }, [members, shiftsByMember, days]);

  const totalBreachDays = view === 'command'
    ? deptRows.reduce((s, r) => s + r.breaches, 0)
    : chiefRows.reduce((s, r) => s + r.breaches, 0);
  const worstDept = view === 'command' ? deptRows.find((r) => r.breaches > 0) : null;
  const worstCrew = view === 'chief' ? chiefRows.find((r) => r.breaches > 0) : null;

  // Vessel watch — PLACEHOLDER. The watch-schedule model isn't built yet, so
  // this shows the first few active crew as a stand-in for "on watch today".
  const vesselWatch = useMemo(() => members.slice(0, 3).map((m) => ({
    name: m.name, isYou: m.id === me?.id,
  })), [members, me?.id]);

  const busy = loading || rotaLoading;
  const failed = error || Boolean(rotaError);

  const initials = (name) => {
    const p = String(name).trim().split(/\s+/);
    return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase();
  };
  const surname = (name) => {
    const p = String(name).trim().split(/\s+/);
    return p.length === 1 ? p[0] : `${p[0][0]}. ${p[p.length - 1]}`;
  };

  const StatusCell = ({ s }) => (
    <span className={`rw-cell${s === 'breach' ? ' is-breach' : s === 'marginal' ? ' is-marginal' : ''}`} />
  );

  const Legend = ({ command }) => (
    <div className="rw-legend">
      <span><i style={{ background: 'var(--rw-sage)' }} />{command ? 'All compliant' : 'Compliant'}</span>
      <span><i style={{ background: 'var(--rw-amber)' }} />Marginal</span>
      <span><i style={{ background: 'var(--rw-red)' }} />Breach</span>
    </div>
  );

  return (
    <div className="ce-card rw rounded-xl p-5">
      <div className="rw-head">
        <span className="rw-title">{view === 'crew' ? 'My rota' : 'Rota'}</span>
        <button type="button" className="rw-link" onClick={() => navigate('/crew')}>
          {view === 'crew' ? 'Full rota →' : 'Open rota →'}
        </button>
      </div>

      {busy ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
          <div className="rw-skel" /><div className="rw-skel" style={{ height: 88 }} />
        </div>
      ) : failed ? (
        <div className="rw-err">
          <Icon name="AlertTriangle" size={16} /> Couldn’t load the rota.
          <button type="button" className="rw-retry" onClick={load}>Retry</button>
        </div>
      ) : !rota?.id ? (
        <p className="rw-empty">No rota configured yet.</p>
      ) : (
        <>
          {/* Shared spine: log your own hours to your HOR record (never the rota) */}
          <div className="rw-eyebrow">{`Today · ${WD[new Date().getDay()]} ${new Date().getDate()} · Hours of Rest`}</div>
          {(myToday || logRest) ? (
            <>
              <div className="rw-hero">
                <div className="rw-blk">
                  <div className="rw-lb">On</div>
                  <TimeWheel value={editStart} onChange={setEditStart} ariaLabel="Actual start time" className="rw-tm rw-tm-edit" />
                </div>
                <div className="rw-arw"><span className="rw-du">{editHours}h</span><ArrowSvg /></div>
                <div className="rw-blk">
                  <div className="rw-lb">Off</div>
                  <TimeWheel value={editEnd} onChange={setEditEnd} ariaLabel="Actual finish time" className="rw-tm rw-tm-edit" />
                </div>
              </div>
              <div className="rw-hormeta">
                {saveErr
                  ? <b className="rw-bad">Couldn’t save — try again</b>
                  : loggedToday
                    ? <><b className="rw-ok">Logged ✓</b> — this is your Hours of Rest, the rota is unchanged</>
                    : <>Tap a time to set your actual hours — logs to <b>your Hours of Rest</b>, not the rota</>}
              </div>
              {myWeekRest != null && (
                <div className={`rw-restline${myBreach ? ' is-breach' : ''}`}>{myBreach ? 'Rest-hour breach' : 'Within rest limits'} · {myWeekRest}h this week</div>
              )}
              <button type="button" className="rw-confirm" disabled={saving} onClick={saveHours}>
                {saving ? 'Saving…' : loggedToday ? 'Update my Hours of Rest' : 'Save to my Hours of Rest'}
              </button>
            </>
          ) : (
            <>
              <div className="rw-herometa" style={{ borderBottom: 0, paddingTop: 10 }}>
                <b>Rest day today</b>{myWeekRest != null ? ` · ${myWeekRest}h rest this week` : ''}
              </div>
              <button type="button" className="rw-linkbtn" onClick={() => { setEditStart('08:00'); setEditEnd('12:00'); setSaveErr(false); setLogRest(true); }}>Worked today? Log hours →</button>
            </>
          )}

          {/* Crew: coming-up strip + vessel watch */}
          {view === 'crew' && (
            <>
              <div className="rw-seclab">Coming up</div>
              <div className="rw-strip">
                {comingUp.map((d) => (
                  <div key={d.date} className={`rw-day${d.span ? '' : ' is-rest'}`}>
                    <div className="rw-wd">{d.wd}</div>
                    <div className="rw-dn">{d.dn}</div>
                    {d.span ? (
                      <><div className="rw-t1">{d.span.start}</div><div className="rw-t2">{d.span.end}</div></>
                    ) : (
                      <><div className="rw-t1">Rest</div><div className="rw-t2">&nbsp;</div></>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Chief: own next shift (personal) then department compliance */}
          {view === 'chief' && (
            <>
              <div className="rw-seclab">Tomorrow</div>
              <div className="rw-tmrw">
                <span className="rw-d">{tomorrowLabel}</span>
                {myTomorrow ? (
                  <span className="rw-mini"><span className="rw-mt">{myTomorrow.start}</span><span className="rw-ar"><ArrowSvg w={30} /></span><span className="rw-mt">{myTomorrow.end}</span></span>
                ) : (
                  <span className="rw-d">Rest day</span>
                )}
              </div>
            </>
          )}
          {view === 'chief' && chiefRows.length > 0 && (
            <>
              <div className="rw-divider" />
              <div className="rw-seclab">{me?.department} · rest compliance</div>
              <div className="rw-grid-hd"><span className="rw-h">Crew</span>{days.map((d, i) => <span key={d}>{WD1[new Date(`${d}T00:00:00`).getDay()]}</span>)}<span /></div>
              {chiefRows.map((r) => (
                <div key={r.name} className="rw-grow">
                  <span className="rw-gl">{surname(r.name)}</span>
                  {r.cells.map((c, i) => <StatusCell key={i} s={c} />)}
                  <span className={`rw-gc${r.breaches ? ' is-breach' : ' is-clear'}`}>{r.breaches || '✓'}</span>
                </div>
              ))}
              <Legend />
              {worstCrew && (
                <div className="rw-foot"><span className="rw-dot" /><span className="rw-txt">{surname(worstCrew.name)} — {worstCrew.breaches} breach day{worstCrew.breaches !== 1 ? 's' : ''} to sign off</span><button type="button" className="rw-act" onClick={() => navigate('/crew')}>Sign off →</button></div>
              )}
            </>
          )}

          {/* Command: own next shift (personal) then by-department compliance */}
          {view === 'command' && (
            <>
              <div className="rw-seclab">Tomorrow</div>
              <div className="rw-tmrw">
                <span className="rw-d">{tomorrowLabel}</span>
                {myTomorrow ? (
                  <span className="rw-mini"><span className="rw-mt">{myTomorrow.start}</span><span className="rw-ar"><ArrowSvg w={30} /></span><span className="rw-mt">{myTomorrow.end}</span></span>
                ) : (
                  <span className="rw-d">Rest day</span>
                )}
              </div>
            </>
          )}
          {view === 'command' && deptRows.length > 0 && (
            <>
              <div className="rw-divider" />
              <div className="rw-seclab">Rest compliance · by department</div>
              <div className="rw-grid-hd"><span className="rw-h">Dept</span>{days.map((d) => <span key={d}>{WD1[new Date(`${d}T00:00:00`).getDay()]}</span>)}<span /></div>
              {deptRows.map((r) => (
                <div key={r.name} className="rw-grow">
                  <span className="rw-gl">{r.name}</span>
                  {r.cells.map((c, i) => <StatusCell key={i} s={c} />)}
                  <span className={`rw-gc${r.breaches ? ' is-breach' : ' is-clear'}`}>{r.breaches || '✓'}</span>
                </div>
              ))}
              <Legend command />
              {worstDept && (
                <div className="rw-foot"><span className="rw-dot" /><span className="rw-txt">{totalBreachDays} breach day{totalBreachDays !== 1 ? 's' : ''} to sign off · {worstDept.name}</span><button type="button" className="rw-act" onClick={() => navigate('/crew')}>Review →</button></div>
              )}
            </>
          )}

          {/* Vessel watch — placeholder roster (watch-schedule model not built yet) */}
          <div className="rw-seclab">Vessel watch · today</div>
          {vesselWatch.length > 0 ? (
            <div className="rw-watch">
              {vesselWatch.map((w) => (
                <span key={w.name} className="rw-wm">
                  <span className={`rw-av${w.isYou ? ' is-you' : ''}`}>{w.isYou ? 'You' : initials(w.name)}</span>
                  <b>{w.isYou ? 'You' : surname(w.name)}</b>
                </span>
              ))}
            </div>
          ) : (
            <p className="rw-empty" style={{ padding: '4px 2px' }}>No one on vessel watch today.</p>
          )}
        </>
      )}
    </div>
  );
};

export default RotaWidget;

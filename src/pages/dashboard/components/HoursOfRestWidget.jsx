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

// Hours of Rest widget — role-scoped rest logging + compliance.
//   • Everyone: confirm today's actual hours (per-block wheels) to their own
//     HOR record (hor_work_entries) — never the rota.
//   • Chief: their department's per-crew rest-compliance grid + sign-off.
//   • Command: rest compliance rolled up by department.
// Compliance is computed live from assessMlc (MLC 2006 A2.3). The schedule
// itself (coming up, vessel watch) lives in the separate Rota widget.

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

// Every on-duty BLOCK for a date (a split shift = several), earliest first.
// The break between two blocks is just the gap between them.
function blocksForDay(shifts, date) {
  return shifts
    .filter((s) => s.date === date && ON_DUTY_TYPES.has(s.shiftType))
    .map((s) => ({ start: hhmm(s.startTime), end: hhmm(s.endTime) }))
    .filter((b) => b.start && b.end)
    .sort((a, b) => a.start.localeCompare(b.start));
}
// Decimal hours of one block (overnight-aware).
const blockDur = (b) => {
  const [sh, sm] = b.start.split(':').map(Number);
  const [eh, em] = b.end.split(':').map(Number);
  let d = (eh + em / 60) - (sh + sm / 60); if (d <= 0) d += 24;
  return d;
};

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
const blockToHHMM = (b) => `${pad2(Math.floor(b / 2))}:${pad2((b % 2) * 30)}`;
// A logged HOR day (hor_work_entries.work_segments) → a single on-duty span so
// it can slot into the same rest math + hero the planned shifts use.
function entryToShift(date, segments, types) {
  if (!Array.isArray(segments) || segments.length === 0) return null; // logged rest day
  const min = Math.min(...segments); const max = Math.max(...segments);
  const type = (types && Object.values(types)[0]) || 'duty';
  return { memberId: null, date, startTime: blockToHHMM(min), endTime: blockToHHMM(max + 1), shiftType: type, logged: true };
}

// Merge a member's logged actuals over their planned shifts — logged days win.
function mergeMemberShifts(planned, userEntries) {
  if (!userEntries || userEntries.size === 0) return planned;
  const loggedDates = new Set(userEntries.keys());
  const base = planned.filter((s) => !loggedDates.has(s.date));
  const logged = [];
  for (const [date, e] of userEntries) { const sh = entryToShift(date, e.segments, e.types); if (sh) logged.push(sh); }
  return base.concat(logged);
}

const ArrowSvg = ({ w = 40 }) => (
  <svg width={w} height="10" viewBox="0 0 40 10" fill="none" aria-hidden="true">
    <path d="M0 5h34m0 0-5-4m5 4-5 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const HoursOfRestWidget = () => {
  const navigate = useNavigate();
  const { user, activeTenantId, tenantRole } = useAuth();
  const { rota, loading: rotaLoading, error: rotaError } = useCurrentRota();

  const [members, setMembers] = useState([]);
  const [shiftsByMember, setShiftsByMember] = useState(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // The current user's own logged HOR actuals (date → {segments, types}).
  const [myEntries, setMyEntries] = useState(() => new Map());
  // Every readable crew member's logged actuals (userId → date → {segments,types})
  // — merged over the plan in the compliance grid.
  const [entriesByUser, setEntriesByUser] = useState(() => new Map());
  // The editable on-duty blocks the wheels bind to; a split shift has several.
  // Saved to the HOR log on Confirm.
  const [editBlocks, setEditBlocks] = useState([{ start: '08:00', end: '12:00' }]);
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
        // Logged HOR actuals for the window — tenant-wide; RLS returns the
        // rows this viewer may see (their own; their department for CHIEF; all
        // for COMMAND), same as the rota page's compliance matrix.
        supabase.from('hor_work_entries')
          .select('subject_user_id, entry_date, work_segments, segment_types')
          .eq('tenant_id', activeTenantId)
          .gte('entry_date', loadStart).lte('entry_date', loadEnd),
      ]);
      if (membersRes.error) throw membersRes.error;
      if (shiftsRes.error) throw shiftsRes.error;

      // Split entries: current user's (for the hero) + by-user (for the grid).
      const em = new Map();
      const byUser = new Map();
      for (const e of (entriesRes.data || [])) {
        const rec = { segments: e.work_segments || [], types: e.segment_types || {} };
        if (!byUser.has(e.subject_user_id)) byUser.set(e.subject_user_id, new Map());
        byUser.get(e.subject_user_id).set(e.entry_date, rec);
        if (e.subject_user_id === user?.id) em.set(e.entry_date, rec);
      }
      setMyEntries(em);
      setEntriesByUser(byUser);

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
      console.error('[HoursOfRestWidget] fetch error:', err);
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

  const myTodayBlocks = useMemo(() => blocksForDay(myShiftsMerged, todayStr), [myShiftsMerged, todayStr]);
  const loggedToday = myEntries.has(todayStr);
  const myTodayType = myShifts.find((s) => s.date === todayStr && ON_DUTY_TYPES.has(s.shiftType))?.shiftType || 'duty';
  const tmrwStr = addDays(todayStr, 1);
  const myReport = useMemo(() => assessMlc({
    dayShifts: myShiftsMerged.filter((s) => s.date === todayStr),
    weekShifts: myShiftsMerged.filter((s) => s.date > addDays(todayStr, -7) && s.date <= todayStr),
  }), [myShiftsMerged, todayStr]);
  const myWeekRest = myReport.pastWeekHours != null ? Math.round(myReport.pastWeekHours) : null;
  const myBreach = myReport.anyBreach;

  // The wheels track the logged (or planned) blocks; re-sync when data changes.
  const blocksKey = myTodayBlocks.map((b) => `${b.start}-${b.end}`).join('|');
  useEffect(() => {
    if (myTodayBlocks.length > 0) setEditBlocks(myTodayBlocks.map((b) => ({ ...b })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocksKey]);

  const editTotalHours = useMemo(
    () => Math.round(editBlocks.reduce((sum, b) => sum + blockDur(b), 0)),
    [editBlocks],
  );
  const setBlock = (i, patch) => setEditBlocks((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const addBlock = () => setEditBlocks((bs) => {
    const last = bs[bs.length - 1];
    const s = last ? Math.min(47, toIdx(last.end) + 2) : 36; // ~1h after last, else 18:00
    return [...bs, { start: blockToHHMM(s), end: blockToHHMM(Math.min(47, s + 8)) }];
  });
  const removeBlock = (i) => setEditBlocks((bs) => (bs.length > 1 ? bs.filter((_, j) => j !== i) : bs));

  const saveHours = async () => {
    setSaving(true); setSaveErr(false);
    try {
      // Accumulate every block's 30-min indices, splitting any overnight block
      // at midnight (today → 24:00, remainder onto tomorrow) so each HOR
      // calendar day gets exactly the on-duty it should.
      const today = new Set(); const todayT = {};
      const next = new Set(); const nextT = {};
      const fill = (set, types, from, to) => { for (let i = from; i < to; i += 1) { set.add(i); types[i] = myTodayType; } };
      for (const b of editBlocks) {
        const s = toIdx(b.start); const e = toIdx(b.end);
        if (e > s) fill(today, todayT, s, e);
        else { fill(today, todayT, s, 48); fill(next, nextT, 0, e); }
      }
      await upsertWorkEntryDay({ tenantId: activeTenantId, subjectUserId: user?.id, date: todayStr, workSegments: [...today].sort((a, b) => a - b), segmentTypes: todayT });
      if (next.size > 0) await upsertWorkEntryDay({ tenantId: activeTenantId, subjectUserId: user?.id, date: tmrwStr, workSegments: [...next].sort((a, b) => a - b), segmentTypes: nextT });
      setLogRest(false);
      await load();
    } catch (err) {
      console.error('[HoursOfRestWidget] confirm hours failed:', err);
      setSaveErr(true);
    } finally {
      setSaving(false);
    }
  };

  // ── Compliance grids ─────────────────────────────────────────
  const chiefMembers = useMemo(() => (
    me?.departmentId ? members.filter((m) => m.departmentId === me.departmentId) : []
  ), [members, me?.departmentId]);

  const chiefRows = useMemo(() => chiefMembers.map((m) => {
    const sh = mergeMemberShifts(shiftsByMember.get(m.id) || [], entriesByUser.get(m.userId));
    const cells = days.map((d) => dayStatus(sh, d));
    return { name: m.name, cells, breaches: cells.filter((c) => c === 'breach').length };
  }).sort((a, b) => b.breaches - a.breaches), [chiefMembers, shiftsByMember, entriesByUser, days]);

  const deptRows = useMemo(() => {
    // A department is "in use" because it has active crew — inviting a crew
    // member into a department (e.g. a pilot → Aviation) is what puts it on
    // this list. Crew with no department don't form a department row.
    const byDept = new Map();
    for (const m of members) {
      if (!m.departmentId) continue;
      if (!byDept.has(m.departmentId)) byDept.set(m.departmentId, { name: m.department, mem: [] });
      byDept.get(m.departmentId).mem.push(m);
    }
    return [...byDept.values()].map((dep) => {
      const cells = days.map((d) => dep.mem.reduce((acc, m) => worse(acc, dayStatus(mergeMemberShifts(shiftsByMember.get(m.id) || [], entriesByUser.get(m.userId)), d)), 'compliant'));
      return { name: dep.name, cells, breaches: cells.filter((c) => c === 'breach').length };
    }).sort((a, b) => b.breaches - a.breaches);
  }, [members, shiftsByMember, entriesByUser, days]);

  const totalBreachDays = view === 'command'
    ? deptRows.reduce((s, r) => s + r.breaches, 0)
    : chiefRows.reduce((s, r) => s + r.breaches, 0);
  const worstDept = view === 'command' ? deptRows.find((r) => r.breaches > 0) : null;
  const worstCrew = view === 'chief' ? chiefRows.find((r) => r.breaches > 0) : null;

  const busy = loading || rotaLoading;
  const failed = error || Boolean(rotaError);

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
        <span className="rw-title">Hours of Rest</span>
        <button type="button" className="rw-link" onClick={() => navigate('/my-profile?tab=hor')}>
          Rest log →
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
          {/* Log your own hours to your HOR record (never the rota) */}
          <div className="rw-eyebrow">{`Confirm today · ${WD[new Date().getDay()]} ${new Date().getDate()}`}</div>
          {(myTodayBlocks.length > 0 || logRest) ? (
            <>
              {editBlocks.map((b, i) => {
                const prev = editBlocks[i - 1];
                const gap = prev ? Math.round((toIdx(b.start) - toIdx(prev.end)) / 2) : 0;
                return (
                  <React.Fragment key={i}>
                    {prev && gap > 0 && <div className="rw-break">break · {gap}h</div>}
                    <div className="rw-hero rw-hero-block">
                      <div className="rw-blk">
                        <div className="rw-lb">On</div>
                        <TimeWheel value={b.start} onChange={(v) => setBlock(i, { start: v })} ariaLabel={`Block ${i + 1} start`} className="rw-tm rw-tm-edit rw-tm-sm" />
                      </div>
                      <div className="rw-arw"><span className="rw-du">{Math.round(blockDur(b))}h</span><ArrowSvg w={34} /></div>
                      <div className="rw-blk">
                        <div className="rw-lb">Off</div>
                        <TimeWheel value={b.end} onChange={(v) => setBlock(i, { end: v })} ariaLabel={`Block ${i + 1} finish`} className="rw-tm rw-tm-edit rw-tm-sm" />
                      </div>
                      {editBlocks.length > 1 && (
                        <button type="button" className="rw-blk-rm" onClick={() => removeBlock(i)} aria-label={`Remove block ${i + 1}`}>✕</button>
                      )}
                    </div>
                  </React.Fragment>
                );
              })}
              <button type="button" className="rw-addblk" onClick={addBlock}>+ Add another block</button>
              {saveErr && <div className="rw-hormeta"><b className="rw-bad">Couldn’t save — try again</b></div>}
              <button type="button" className="rw-confirm" disabled={saving} onClick={saveHours}>
                {saving ? 'Saving…' : loggedToday ? 'Update Hours of Rest' : 'Save to Hours of Rest'}
              </button>
            </>
          ) : (
            <>
              <div className="rw-herometa" style={{ borderBottom: 0, paddingTop: 10 }}>
                <b>Rest day today</b>{myWeekRest != null ? ` · ${myWeekRest}h rest this week` : ''}
              </div>
              <button type="button" className="rw-linkbtn" onClick={() => { setEditBlocks([{ start: '08:00', end: '12:00' }]); setSaveErr(false); setLogRest(true); }}>Worked today? Log hours →</button>
            </>
          )}

          {/* Chief: their department's rest compliance */}
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

          {/* Command: rest compliance by department */}
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

        </>
      )}
    </div>
  );
};

export default HoursOfRestWidget;

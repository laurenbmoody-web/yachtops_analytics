import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import CrewWeekMatrix from '../crew-rota/CrewWeekMatrix';
import { reviewerEditCells } from '../crew-rota/reviewerEditsDiff';

// SnapshotRotaLines — read-only reconstruction of the affected crew's rota
// lines for a resolved submission, rebuilt from the snapshots frozen at submit
// / accept time (the live rota may have changed since). Reuses the week-matrix
// row rendering; no editing.
//
// When the reviewer edited the rota before accepting (an 'approved' snapshot
// exists and differs from the 'submitted' one), the grid shows the APPROVED
// (final) hours and flags each changed cell with a pencil — clicking it reveals
// the originally-submitted hours. Otherwise it shows the submitted rota as-is.

function pad2(n) { return String(n).padStart(2, '0'); }
function toLocalStr(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseLocal(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addLocalDays(s, n) { const d = parseLocal(s); d.setDate(d.getDate() + n); return toLocalStr(d); }
function hhmm(t) { return t ? String(t).slice(0, 5) : ''; }
function fmtDayLabel(s) {
  try { return parseLocal(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
  catch { return s; }
}

function toWindowShifts(rows) {
  return (rows || []).map((r) => ({
    id: r.id,
    memberId: r.member_id,
    date: r.shift_date,
    startTime: r.start_time,
    endTime: r.end_time,
    shiftType: r.shift_type,
    subType: r.sub_type,
    status: r.status,
  }));
}

export default function SnapshotRotaLines({ snapshotId, dateStart, dateEnd, rotaId, departmentId }) {
  const [crew, setCrew] = useState([]);
  const [windowShifts, setWindowShifts] = useState([]);
  const [affectedDates, setAffectedDates] = useState([]);
  const [editedCells, setEditedCells] = useState(null); // Set<"memberId|date"> or null
  const [originalByCell, setOriginalByCell] = useState(new Map());
  const [hasEdits, setHasEdits] = useState(false);
  const [selectedDate, setSelectedDate] = useState(dateStart || null);
  const [affectedOnly, setAffectedOnly] = useState(false);
  const [popover, setPopover] = useState(null); // { memberId, date, top, left }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!snapshotId) { setCrew([]); setWindowShifts([]); setAffectedDates([]); setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true);
    setPopover(null);
    (async () => {
      // Submitted snapshot (what the HOD sent) + the approved one if it exists
      // (taken at accept, after any reviewer edits).
      const submittedReq = supabase
        .from('rota_shift_snapshots').select('shift_data').eq('id', snapshotId).maybeSingle();
      const approvedReq = (rotaId && departmentId)
        ? supabase
          .from('rota_shift_snapshots')
          .select('shift_data, snapshot_taken_at')
          .eq('rota_id', rotaId).eq('department_id', departmentId)
          .eq('source_event_type', 'approved')
          .order('snapshot_taken_at', { ascending: false })
          .limit(1).maybeSingle()
        : Promise.resolve({ data: null });
      const [{ data: snap }, { data: app }] = await Promise.all([submittedReq, approvedReq]);
      if (cancelled) return;

      const submittedRows = Array.isArray(snap?.shift_data) ? snap.shift_data : [];
      const approvedRows = Array.isArray(app?.shift_data) ? app.shift_data : null;

      // Reviewer edits = cells that differ between submitted and approved.
      const edit = approvedRows
        ? reviewerEditCells(submittedRows, approvedRows)
        : { cells: new Set(), dates: [] };
      const edited = edit.cells.size > 0;

      // Edited → show the final (approved) rota; otherwise the submitted one.
      const displayRows = edited ? approvedRows : submittedRows;
      const ws = toWindowShifts(displayRows);

      // Highlight dates: reviewer-edited days when edited, else the days the
      // HOD changed in this submission (rows frozen as 'draft' at submit time).
      const changedDays = [...new Set(
        ws.filter((s) => s.status === 'draft' && s.date).map((s) => s.date),
      )].sort();
      const affected = edited
        ? edit.dates
        : (changedDays.length ? changedDays : [dateStart, dateEnd].filter(Boolean));

      const earliestShift = ws.map((s) => s.date).filter(Boolean).sort()[0];
      const landOn = affected[0] || dateStart || earliestShift || null;

      // Original submitted hours per cell — for the pencil popover.
      const original = new Map();
      for (const r of submittedRows) {
        if (!r?.member_id || !r?.shift_date) continue;
        const key = `${r.member_id}|${r.shift_date}`;
        if (!original.has(key)) original.set(key, []);
        original.get(key).push({ start: r.start_time, end: r.end_time });
      }
      for (const list of original.values()) list.sort((a, b) => String(a.start).localeCompare(String(b.start)));

      // Crew = union of members across both snapshots, so members the reviewer
      // fully erased still get a (now-empty) flagged row.
      const memberIds = [...new Set(
        [...submittedRows, ...(approvedRows || [])].map((r) => r?.member_id).filter(Boolean),
      )];
      if (!memberIds.length) { if (!cancelled) { setCrew([]); setWindowShifts([]); setLoading(false); } return; }
      const { data: members } = await supabase
        .from('tenant_members')
        .select(`
          id, user_id, display_name, permission_tier, department_id,
          departments ( name, color ),
          profiles ( full_name ),
          role:roles!role_id ( name ),
          custom_role:tenant_custom_roles!custom_role_id ( name )
        `)
        .in('id', memberIds);
      if (cancelled) return;
      const mapped = (members || []).map((m) => ({
        id: m.id,
        name: m.display_name || m.profiles?.full_name || 'Unknown',
        role: m.role?.name || m.custom_role?.name || null,
        department: m.departments?.name || '',
        departmentId: m.department_id || null,
        departmentColor: m.departments?.color || '#5F5E5A',
      }));

      setCrew(mapped);
      setWindowShifts(ws);
      setAffectedDates(affected);
      setEditedCells(edited ? edit.cells : null);
      setOriginalByCell(original);
      setHasEdits(edited);
      setSelectedDate(landOn);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [snapshotId, dateStart, dateEnd, rotaId, departmentId]);

  const onCellClick = (date, memberId, rect) => {
    if (!editedCells || !editedCells.has(`${memberId}|${date}`) || !rect) return;
    const left = Math.min(Math.max(rect.left, 8), window.innerWidth - 268);
    setPopover({ memberId, date, top: rect.bottom + 6, left });
  };

  if (!snapshotId) return null;
  if (loading) return <div className="rv-resolved-lines-empty">Loading rota…</div>;
  if (!crew.length) return null;

  const popName = popover ? (crew.find((c) => c.id === popover.memberId)?.name || 'Crew') : '';
  const popLines = popover ? (originalByCell.get(`${popover.memberId}|${popover.date}`) || []) : [];

  return (
    <div className="rv-resolved-lines">
      <div className="rv-resolved-lines-head">
        <span className="rv-resolved-lines-label">
          {hasEdits ? 'Rota as approved' : 'Rota as submitted'}
        </span>
        {affectedDates.length > 0 && (
          <button
            type="button"
            role="checkbox"
            aria-checked={affectedOnly}
            className={`rv-resolved-lines-toggle${affectedOnly ? ' is-on' : ''}`}
            onClick={() => setAffectedOnly((v) => !v)}
          >
            <span className="rv-resolved-lines-swatch">
              {affectedOnly && <Check size={10} strokeWidth={3} />}
            </span>
            Dates affected only
          </button>
        )}
      </div>
      {hasEdits && (
        <div className="rv-resolved-lines-note">
          Reviewer edits shown. Tap a <span className="rv-resolved-lines-pencil" /> cell to see the originally-submitted hours.
        </div>
      )}
      <CrewWeekMatrix
        crew={crew}
        windowShifts={windowShifts}
        selectedDate={selectedDate}
        realToday={null}
        affectedDates={affectedDates}
        editedCells={editedCells}
        dayList={affectedOnly ? affectedDates : null}
        onCellClick={onCellClick}
        onStepDay={(dir) => setSelectedDate((s) => addLocalDays(s, dir))}
      />

      {popover && (
        <>
          <div className="rv-edit-pop-backdrop" onClick={() => setPopover(null)} />
          <div className="rv-edit-pop" style={{ top: popover.top, left: popover.left }} role="dialog">
            <div className="rv-edit-pop-head">
              <span className="rv-edit-pop-name">{popName}</span> · {fmtDayLabel(popover.date)}
            </div>
            <div className="rv-edit-pop-k">Originally submitted</div>
            {popLines.length ? (
              popLines.map((l, i) => (
                <div key={i} className="rv-edit-pop-line">{hhmm(l.start)}–{hhmm(l.end)}</div>
              ))
            ) : (
              <div className="rv-edit-pop-off">Off — no shift submitted</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

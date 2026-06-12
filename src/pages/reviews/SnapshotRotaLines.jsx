import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import CrewWeekMatrix from '../crew-rota/CrewWeekMatrix';

// SnapshotRotaLines — read-only reconstruction of the affected crew's rota
// lines for a resolved submission, rebuilt from the snapshot frozen at submit
// time (the live rota may have changed since). Reuses the week-matrix row
// rendering; no cell handlers = read-only. The window can be stepped for
// submissions spanning more than 7 days.

function pad2(n) { return String(n).padStart(2, '0'); }
function toLocalStr(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseLocal(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addLocalDays(s, n) { const d = parseLocal(s); d.setDate(d.getDate() + n); return toLocalStr(d); }

export default function SnapshotRotaLines({ snapshotId, dateStart, dateEnd }) {
  const [crew, setCrew] = useState([]);
  const [windowShifts, setWindowShifts] = useState([]);
  const [affectedDates, setAffectedDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState(dateStart || null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!snapshotId) { setCrew([]); setWindowShifts([]); setAffectedDates([]); setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: snap } = await supabase
        .from('rota_shift_snapshots').select('shift_data').eq('id', snapshotId).maybeSingle();
      const rows = Array.isArray(snap?.shift_data) ? snap.shift_data : [];
      // to_jsonb(rota_shifts.*) → the windowShifts shape the matrix consumes.
      // The snapshot is the WHOLE department rota (all dates, published +
      // draft), so it carries the surrounding context — not just the change.
      const ws = rows.map((r) => ({
        id: r.id,
        memberId: r.member_id,
        date: r.shift_date,
        startTime: r.start_time,
        endTime: r.end_time,
        shiftType: r.shift_type,
        subType: r.sub_type,
        status: r.status,
      }));
      // The days actually CHANGED in this submission = the rows frozen as
      // 'draft' at submit time (everything else was already published). These
      // get the column highlight, and the window lands on the first of them.
      const changedDays = [...new Set(
        ws.filter((s) => s.status === 'draft' && s.date).map((s) => s.date),
      )].sort();
      // Fallback when the snapshot carries no draft rows (e.g. legacy/seed
      // data): use the submission's reported range so the highlight still
      // points somewhere sensible.
      const affected = changedDays.length
        ? changedDays
        : [dateStart, dateEnd].filter(Boolean);
      // Land on the first changed day; fall back to date_start, then to the
      // earliest shift in the snapshot so the grid is never blank.
      const earliestShift = ws.map((s) => s.date).filter(Boolean).sort()[0];
      const landOn = affected[0] || dateStart || earliestShift || null;
      const memberIds = [...new Set(ws.map((s) => s.memberId).filter(Boolean))];
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
      setSelectedDate(landOn);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [snapshotId, dateStart, dateEnd]);

  if (!snapshotId) return null;
  if (loading) return <div className="rv-resolved-lines-empty">Loading rota…</div>;
  if (!crew.length) return null;

  return (
    <div className="rv-resolved-lines">
      <div className="rv-resolved-lines-head">
        <span className="rv-resolved-lines-label">Rota as submitted</span>
        {affectedDates.length > 0 && (
          <span className="rv-resolved-lines-legend">
            <span className="rv-resolved-lines-swatch" />
            Days changed in this submission
          </span>
        )}
      </div>
      <CrewWeekMatrix
        crew={crew}
        windowShifts={windowShifts}
        selectedDate={selectedDate}
        realToday={null}
        affectedDates={affectedDates}
        onStepDay={(dir) => setSelectedDate((s) => addLocalDays(s, dir))}
      />
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
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
  const [selectedDate, setSelectedDate] = useState(dateStart || null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { setSelectedDate(dateStart || null); }, [dateStart]);

  useEffect(() => {
    if (!snapshotId) { setCrew([]); setWindowShifts([]); setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: snap } = await supabase
        .from('rota_shift_snapshots').select('shift_data').eq('id', snapshotId).maybeSingle();
      const rows = Array.isArray(snap?.shift_data) ? snap.shift_data : [];
      // to_jsonb(rota_shifts.*) → the windowShifts shape the matrix consumes.
      const ws = rows.map((r) => ({
        id: r.id,
        memberId: r.member_id,
        date: r.shift_date,
        startTime: r.start_time,
        endTime: r.end_time,
        shiftType: r.shift_type,
        subType: r.sub_type,
      }));
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
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [snapshotId]);

  const realToday = useMemo(() => toLocalStr(new Date()), []);

  if (!snapshotId) return null;
  if (loading) return <div className="rv-resolved-lines-empty">Loading rota…</div>;
  if (!crew.length) return null;

  return (
    <div className="rv-resolved-lines">
      <div className="rv-resolved-lines-label">Rota as submitted</div>
      <CrewWeekMatrix
        crew={crew}
        windowShifts={windowShifts}
        selectedDate={selectedDate}
        realToday={realToday}
        onStepDay={(dir) => setSelectedDate((s) => addLocalDays(s, dir))}
      />
    </div>
  );
}

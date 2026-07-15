// Snag report / work-list — the filterable triage view a Chief works from and a
// yard signs off, plus PDF/Excel export for warranty / refit / class handover.
// Rows fly-to-pin on the vessel map when the defect is pinned there.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ModalShell from '../../../components/ui/ModalShell';
import { useDefectActor } from '../utils/useDefectActor';
import { getAllDefects, DefectStatus } from '../utils/defectsStorage';
import { exportSnagPdf, exportSnagExcel } from '../utils/snagReportExport';
import './SnagReportModal.css';

const STATUS_LABEL = {
  pending_acceptance: 'Pending acceptance', New: 'New', Reopened: 'Reopened', Assigned: 'Assigned',
  InProgress: 'In progress', WaitingParts: 'Waiting parts', Fixed: 'Fixed', Closed: 'Closed', declined: 'Declined',
};
const fmt = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

const FILTERS = [
  { key: 'open', label: 'All open', test: (d) => d.status !== DefectStatus.CLOSED && d.status !== 'declined' },
  { key: 'critical', label: 'Critical', test: (d) => d.priority === 'Critical' && d.status !== DefectStatus.CLOSED },
  { key: 'pending', label: 'Awaiting acceptance', test: (d) => d.status === DefectStatus.PENDING_ACCEPTANCE },
  { key: 'progress', label: 'In progress', test: (d) => d.status === DefectStatus.IN_PROGRESS },
  { key: 'parts', label: 'Waiting parts', test: (d) => d.status === DefectStatus.WAITING_PARTS },
  { key: 'guest', label: 'Guest areas', test: (d) => d.affectsGuestAreas && d.status !== DefectStatus.CLOSED },
  { key: 'closed', label: 'Closed', test: (d) => d.status === DefectStatus.CLOSED },
  { key: 'all', label: 'Everything', test: () => true },
];

const ownerOf = (d) => {
  if (d.assigneeKind === 'team') return { name: `${d.assignedTeamName || d.departmentOwner || ''} team`, none: false };
  if (d.assignedToUserId) return { name: d.assignedToName || 'Assigned', none: false };
  return { name: 'Unassigned', none: true };
};

export default function SnagReportModal({ onClose, vesselName = 'Vessel' }) {
  const actor = useDefectActor();
  const navigate = useNavigate();
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('open');
  const [q, setQ] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      const rows = await getAllDefects(actor);
      if (live) { setAll(rows || []); setLoading(false); }
    })();
    return () => { live = false; };
  }, [actor?.tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = FILTERS.find((f) => f.key === filter) || FILTERS[0];
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return all.filter(active.test).filter((d) => !query
      || (d.title || '').toLowerCase().includes(query)
      || (d.locationPathLabel || d.locationFreeText || '').toLowerCase().includes(query)
      || (d.ref || '').toLowerCase().includes(query));
  }, [all, active, q]);

  const counts = useMemo(() => {
    const c = {};
    FILTERS.forEach((f) => { c[f.key] = all.filter(f.test).length; });
    return c;
  }, [all]);

  const flyTo = (d) => {
    if (!d.hotspotId) return;
    onClose?.();
    navigate(`/vessel/map?pin=${d.hotspotId}`);
  };

  return (
    <ModalShell onClose={onClose} panelClassName="snag">
      <div className="snag-head">
        <div>
          <p className="eyebrow">Every pin is also a row</p>
          <h3>Snag report</h3>
          <p>The triage list — export for warranty, refit hand-over or a class survey.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="snag-exports">
            <button className="snag-btn" onClick={() => exportSnagExcel(filtered, { vesselName, filterLabel: active.label })}>▤ Excel</button>
            <button className="snag-btn solid" onClick={() => exportSnagPdf(filtered, { vesselName, filterLabel: active.label })}>⎙ Snag report (PDF)</button>
          </div>
          <button className="snag-x" onClick={onClose} aria-label="Close">×</button>
        </div>
      </div>

      <div className="snag-controls">
        <input className="snag-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search defect, location or ref…" />
        <div className="snag-filters">
          {FILTERS.map((f) => (
            <button key={f.key} className={`snag-fpill${filter === f.key ? ' on' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label}<span className="c">{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="snag-scroll">
        {loading ? (
          <div className="snag-empty">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="snag-empty">No defects match this view.</div>
        ) : (
          <table className="snag-t">
            <thead>
              <tr><th>Ref</th><th>Defect</th><th>Priority</th><th>Status</th><th>Owner</th><th>Due</th></tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const owner = ownerOf(d);
                const loc = d.locationPathLabel || d.locationFreeText || '';
                return (
                  <tr key={d.id}>
                    <td className="snag-ref">{d.ref || ''}</td>
                    <td>
                      <div className="snag-def">{d.title}</div>
                      <div className="snag-loc">
                        {loc && <span>📍 {loc}</span>}
                        {d.hotspotId && <span className="snag-fly" onClick={() => flyTo(d)}>· Fly to pin ↗</span>}
                      </div>
                    </td>
                    <td><span className={`snag-chip p-${d.priority}`}><span className="cd" />{d.priority}</span></td>
                    <td><span className="snag-chip snag-status">{STATUS_LABEL[d.status] || d.status}</span></td>
                    <td><span className={`snag-owner${owner.none ? ' none' : ''}`}>{owner.name}</span></td>
                    <td className="snag-due">{fmt(d.dueDate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="snag-foot">Showing {filtered.length} of {all.length} · export respects the current filter.</div>
    </ModalShell>
  );
}

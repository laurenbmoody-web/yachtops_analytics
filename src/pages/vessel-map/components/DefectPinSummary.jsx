// Compact defect summary shown in the map inspector for a defect pin — just
// enough to recognise it, with a button to open the full defect in the wide
// modal. Keeps the narrow drawer uncluttered.
import React, { useEffect, useState } from 'react';
import { useDefectActor } from '../../defects/utils/useDefectActor';
import { getDefectByHotspot } from '../../defects/utils/defectsStorage';
import './DefectPin.css';

const PRIORITY_CLASS = { Critical: 'p-critical', High: 'p-high', Medium: 'p-medium', Low: 'p-low' };
const STATUS_META = {
  pending_acceptance: { cls: 's-pending', label: 'Pending acceptance' },
  New: { cls: 's-open', label: 'New' }, Reopened: { cls: 's-open', label: 'Reopened' }, Assigned: { cls: 's-open', label: 'Assigned' },
  InProgress: { cls: 's-progress', label: 'In progress' }, WaitingParts: { cls: 's-progress', label: 'Waiting parts' },
  Fixed: { cls: 's-fixed', label: 'Fixed' }, Closed: { cls: 's-closed', label: 'Closed' }, declined: { cls: 's-declined', label: 'Declined' },
};

export default function DefectPinSummary({ hotspot, reloadToken, onOpen }) {
  const actor = useDefectActor();
  const [defect, setDefect] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    (async () => {
      const d = hotspot?.id && actor?.tenantId ? await getDefectByHotspot(hotspot.id, actor) : null;
      if (live) { setDefect(d); setLoading(false); }
    })();
    return () => { live = false; };
  }, [hotspot?.id, actor?.tenantId, reloadToken]);

  if (loading) return <div className="vmd"><p className="vmd-loading">Loading defect…</p></div>;

  if (!defect) {
    return (
      <div className="vmd">
        <div className="vmd-empty">
          <span className="vmd-empty-t">No defect logged here</span>
          <span className="vmd-empty-s">Log one — photo, priority and who owns it. It notifies the crew and is tracked through to fixed.</span>
          <button className="vm-btn-primary vmd-empty-btn" onClick={onOpen}>Log a defect here</button>
        </div>
      </div>
    );
  }

  const sMeta = STATUS_META[defect.status] || { cls: 's-open', label: defect.status };
  const pCls = PRIORITY_CLASS[defect.priority] || 'p-medium';
  const owner = defect.assigneeKind === 'team'
    ? `${defect.assignedTeamName || defect.departmentOwner || ''} team`
    : (defect.assignedToName || 'Unassigned');

  return (
    <div className="vmd vmd-summary">
      <div className="vmd-chips">
        <span className={`vmd-chip ${pCls}`}><span className="cd" />{defect.priority}</span>
        <span className={`vmd-chip ${sMeta.cls}`}><span className="cd" />{sMeta.label}</span>
      </div>
      <p className="vmd-title" style={{ fontSize: 16 }}>{defect.title}</p>
      <div className="vmd-assignee-r" style={{ fontSize: 12, color: '#8B8478' }}>Owner · {owner}</div>
      <button className="vm-btn-primary vmd-open-btn" onClick={onOpen}>Open defect →</button>
    </div>
  );
}

// Plan preventive maintenance from a defect — creates a team-jobs entry (with an
// optional repeat), linked back to the defect.
import React, { useState } from 'react';
import ModalShell from '../../../components/ui/ModalShell';
import Icon from '../../../components/AppIcon';
import VmdSelect from '../../vessel-map/components/VmdSelect';
import EditorialDatePicker from '../../../components/editorial/EditorialDatePicker';
import { useDefectActor } from '../utils/useDefectActor';
import { promoteDefectToMaintenance, RECURRENCE_OPTIONS } from '../utils/defectMaintenance';
import './PlanMaintenanceModal.css';

export default function PlanMaintenanceModal({ defect, onClose, onDone }) {
  const actor = useDefectActor();
  const [title, setTitle] = useState(defect.title || '');
  const [dueDate, setDueDate] = useState('');
  const [recurrence, setRecurrence] = useState('quarterly');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!title.trim()) { setErr('Give the job a title.'); return; }
    setBusy(true); setErr('');
    try {
      const job = await promoteDefectToMaintenance(defect, { title, dueDate, recurrence }, actor);
      onDone?.(job);
    } catch (e) {
      setErr(e?.message || 'Could not create the maintenance job.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose} panelClassName="pmm" isBusy={busy}>
      <div className="pmm-head">
        <div>
          <p className="pmm-eyebrow">Planned maintenance · {defect.ref}</p>
          <h3>Prevent this from recurring</h3>
        </div>
        <button className="pmm-x" onClick={onClose} aria-label="Close"><Icon name="X" size={16} /></button>
      </div>

      <div className="pmm-body">
        <p className="pmm-intro">Turn this fault into a scheduled job on the team board so it's serviced before it fails again.</p>
        <div className="pmm-field">
          <label className="pmm-lbl">Job title</label>
          <input className="pmm-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Service watermaker high-pressure pump" />
        </div>
        <div className="pmm-row">
          <div className="pmm-field" style={{ flex: 1 }}>
            <label className="pmm-lbl">First due</label>
            <EditorialDatePicker value={dueDate} onChange={setDueDate} placeholder="dd/mm/yyyy" ariaLabel="First due date" />
          </div>
          <div className="pmm-field" style={{ flex: 1 }}>
            <label className="pmm-lbl">Repeat</label>
            <VmdSelect value={recurrence} onChange={setRecurrence} options={RECURRENCE_OPTIONS} ariaLabel="Repeat interval" />
          </div>
        </div>
        <p className="pmm-hint"><Icon name="Info" size={12} /> Carries the department{defect.assignedToName ? ` and assignee (${defect.assignedToName})` : ''} from this defect. You can fine-tune it on the job board.</p>
      </div>

      {err && <p className="pmm-err">{err}</p>}
      <div className="pmm-foot">
        <button className="pmm-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="pmm-btn primary" onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create job'}</button>
      </div>
    </ModalShell>
  );
}

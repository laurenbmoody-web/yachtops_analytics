// Dashboard quick-add defect modal — now shares the exact log form used on the
// map (DefectLogForm), plus a "View all" deep-link and a "pin it on the map"
// shortcut.
import React from 'react';
import { useNavigate } from 'react-router-dom';
import ModalShell from '../../../components/ui/ModalShell';
import { showToast } from '../../../utils/toast';
import { useDefectActor } from '../utils/useDefectActor';
import { createDefect } from '../utils/defectsStorage';
import DefectLogForm from './DefectLogForm';
import './QuickAddDefectModal.css';

export default function QuickAddDefectModal({ onClose, onSuccess }) {
  const actor = useDefectActor();
  const navigate = useNavigate();

  const handleSubmit = async (payload) => {
    await createDefect(payload, actor);
    showToast('Defect logged', 'success');
    onSuccess?.();
  };

  return (
    <ModalShell onClose={onClose} panelClassName="qad" isBusy={false}>
      <div className="qad-head">
        <h3>Log a defect</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="qad-viewall" onClick={() => navigate('/defects')}>View all →</button>
          <button className="qad-x" onClick={onClose} aria-label="Close">×</button>
        </div>
      </div>
      <div className="qad-body">
        <button type="button" className="qad-map" onClick={() => navigate('/vessel/map')}>
          📍 <span>Prefer to pin it on the map? <b>Open the vessel map →</b></span>
        </button>
        <DefectLogForm onSubmit={handleSubmit} onCancel={onClose} showLocation />
      </div>
    </ModalShell>
  );
}

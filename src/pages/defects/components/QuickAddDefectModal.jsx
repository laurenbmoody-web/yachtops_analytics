// Dashboard quick-add defect modal — now shares the exact log form used on the
// map (DefectLogForm), plus a "View all" deep-link and a "pin it on the map"
// shortcut.
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ModalShell from '../../../components/ui/ModalShell';
import MapPickerModal from '../../vessel-map/components/MapPickerModal';
import { showToast } from '../../../utils/toast';
import { useDefectActor } from '../utils/useDefectActor';
import { createDefect } from '../utils/defectsStorage';
import DefectLogForm from './DefectLogForm';
import './QuickAddDefectModal.css';

export default function QuickAddDefectModal({ onClose, onSuccess }) {
  const actor = useDefectActor();
  const navigate = useNavigate();
  const [pinning, setPinning] = useState(null); // { id, title } — a logged defect awaiting its map pin

  const handleSubmit = async (payload) => {
    await createDefect(payload, actor);
    showToast('Defect logged', 'success');
    onSuccess?.();
  };

  // "Log & pin on map": log the defect first, then open the embedded map picker
  // so the crew can navigate to the space and drop the pin. The defect is already
  // saved, so closing the picker simply leaves it unpinned.
  const handleSubmitAndPin = async (payload) => {
    const created = await createDefect(payload, actor);
    if (created?.id) {
      showToast('Defect logged — now drop the pin', 'success');
      setPinning({ id: created.id, title: created.title || payload.title });
    } else {
      showToast('Defect logged', 'success');
      onSuccess?.();
    }
  };

  return (
    <>
      <ModalShell onClose={onClose} panelClassName="qad" isBusy={false}>
        <div className="qad-head">
          <h3>Log a defect</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="qad-viewall" onClick={() => navigate('/defects')}>View all →</button>
            <button className="qad-x" onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>
        <div className="qad-body">
          <DefectLogForm onSubmit={handleSubmit} onSubmitAndPin={handleSubmitAndPin} onCancel={onClose} showLocation />
        </div>
      </ModalShell>
      {pinning && (
        <MapPickerModal
          placingDefect={pinning}
          onPlaced={() => { setPinning(null); showToast('Defect pinned to the map', 'success'); onSuccess?.(); }}
          onClose={() => { setPinning(null); onSuccess?.(); }}
        />
      )}
    </>
  );
}

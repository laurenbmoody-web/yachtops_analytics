// The defect opens in a wide modal across the app — there's a lot on a defect
// (log form, owner, comments, lifecycle) and the narrow map inspector cramps it.
// Hosts the full DefectPin experience with room to breathe.
import React from 'react';
import ModalShell from '../../../components/ui/ModalShell';
import DefectPin from './DefectPin';
import './DefectPin.css';

export default function DefectModal({ hotspot, canManage, scanName, containerTrail, onChanged, onClose }) {
  return (
    <ModalShell onClose={onClose} panelClassName="vmd-modal">
      <div className="vmd-modal-head">
        <div>
          <p className="vmd-modal-eyebrow">Defect · {scanName || 'Vessel map'}</p>
          <h3>{hotspot?.label || 'Defect pin'}</h3>
        </div>
        <button className="vmd-modal-x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="vmd-modal-body">
        <DefectPin hotspot={hotspot} canManage={canManage} scanName={scanName} containerTrail={containerTrail} onChanged={onChanged} />
      </div>
    </ModalShell>
  );
}

// Wide modal hosting the defect across the app. Bare shell — DefectPin owns the
// content (the log form when empty, the two-column DefectDetail once logged), so
// there's no duplicate header.
import React from 'react';
import ModalShell from '../../../components/ui/ModalShell';
import DefectPin from './DefectPin';
import './DefectPin.css';

export default function DefectModal({ hotspot, canManage, scanName, containerTrail, onChanged, onTitled, onClose }) {
  return (
    <ModalShell onClose={onClose} panelClassName="vmd-modal">
      <button className="vmd-xfloat" onClick={onClose} aria-label="Close">×</button>
      <div className="vmd-scroll">
        <DefectPin
          hotspot={hotspot}
          canManage={canManage}
          scanName={scanName}
          containerTrail={containerTrail}
          onChanged={onChanged}
          onTitled={onTitled}
          onCancel={onClose}
        />
      </div>
    </ModalShell>
  );
}

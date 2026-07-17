// Wide modal hosting the defect across the app. Bare shell — DefectPin owns the
// content (the log form when empty, the two-column DefectDetail once logged), so
// there's no duplicate header.
import React, { useState } from 'react';
import ModalShell from '../../../components/ui/ModalShell';
import Icon from '../../../components/AppIcon';
import DefectPin from './DefectPin';
import './DefectPin.css';

export default function DefectModal({ hotspot, canManage, scanName, containerTrail, onChanged, onTitled, onClose }) {
  // 'form' → narrow single-column log form (matches the dashboard quick-add);
  // 'detail' → wide two-column DefectDetail. Defaults to the form width.
  const [mode, setMode] = useState('form');
  return (
    <ModalShell onClose={onClose} panelClassName={`vmd-modal${mode === 'detail' ? '' : ' vmd-modal--form'}`}>
      <button className="vmd-xfloat" onClick={onClose} aria-label="Close"><Icon name="X" size={16} /></button>
      <div className="vmd-scroll">
        <DefectPin
          hotspot={hotspot}
          canManage={canManage}
          scanName={scanName}
          containerTrail={containerTrail}
          onChanged={onChanged}
          onTitled={onTitled}
          onCancel={onClose}
          onMode={setMode}
        />
      </div>
    </ModalShell>
  );
}

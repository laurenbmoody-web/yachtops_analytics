// Wide modal hosting the defect across the app. Bare shell — DefectPin owns the
// content (the log form when empty, the two-column DefectDetail once logged), so
// there's no duplicate header. Map-pin management (reposition / remove the pin)
// lives in a small ⋯ menu here, so it isn't lost now that clicking a defect pin
// opens this modal directly instead of the inspector drawer.
import React, { useEffect, useRef, useState } from 'react';
import ModalShell from '../../../components/ui/ModalShell';
import Icon from '../../../components/AppIcon';
import DefectPin from './DefectPin';
import './DefectPin.css';

export default function DefectModal({ hotspot, canManage, scanName, containerTrail, onChanged, onTitled, onClosed, onAdjust, onDelete, onClose }) {
  // 'form' → narrow single-column log form (matches the dashboard quick-add);
  // 'detail' → wide two-column DefectDetail. Defaults to the form width.
  const [mode, setMode] = useState('form');
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [delErr, setDelErr] = useState(null);
  const manageRef = useRef(null);

  const canPinManage = canManage && (onAdjust || onDelete);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => { if (!manageRef.current?.contains(e.target)) { setMenuOpen(false); setConfirmDel(false); } };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const doDelete = async () => {
    if (deleting) return;
    setDeleting(true); setDelErr(null);
    const failure = await onDelete?.();
    setDeleting(false);
    if (failure) { setDelErr(failure); setConfirmDel(false); }
    // On success the parent clears the selection and this modal unmounts.
  };

  return (
    <ModalShell onClose={onClose} panelClassName={`vmd-modal${mode === 'detail' ? '' : ' vmd-modal--form'}`}>
      {canPinManage && (
        <div className="vmd-manage" ref={manageRef}>
          <button className="vmd-manage-btn" onClick={() => setMenuOpen((v) => !v)} aria-label="Pin options" title="Pin options">
            <Icon name="MoreHorizontal" size={16} />
          </button>
          {menuOpen && (
            <div className="vmd-manage-menu" role="menu">
              {onAdjust && (
                <button className="vmd-manage-item" role="menuitem" onClick={() => { setMenuOpen(false); onAdjust(); }}>
                  <Icon name="Move" size={14} /> Adjust position
                </button>
              )}
              {onDelete && !confirmDel && (
                <button className="vmd-manage-item vmd-manage-danger" role="menuitem" onClick={() => setConfirmDel(true)}>
                  <Icon name="Trash2" size={14} /> Remove pin
                </button>
              )}
              {onDelete && confirmDel && (
                <div className="vmd-manage-confirm">
                  <p>Remove the map pin? The defect stays in Defects — only the pin goes.</p>
                  <div className="vmd-manage-confirm-row">
                    <button className="vmd-manage-remove" onClick={doDelete} disabled={deleting}>
                      {deleting ? 'Removing…' : 'Remove pin'}
                    </button>
                    <button className="vmd-manage-keep" onClick={() => setConfirmDel(false)} disabled={deleting}>Keep</button>
                  </div>
                </div>
              )}
              {delErr && <p className="vmd-manage-err">{delErr}</p>}
            </div>
          )}
        </div>
      )}
      <button className="vmd-xfloat" onClick={onClose} aria-label="Close"><Icon name="X" size={16} /></button>
      <div className="vmd-scroll">
        <DefectPin
          hotspot={hotspot}
          canManage={canManage}
          scanName={scanName}
          containerTrail={containerTrail}
          onChanged={onChanged}
          onTitled={onTitled}
          onClosed={onClosed}
          onCancel={onClose}
          onMode={setMode}
        />
      </div>
    </ModalShell>
  );
}

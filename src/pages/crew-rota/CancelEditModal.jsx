import React, { useEffect } from 'react';
import { X } from 'lucide-react';

// HOD cancel-edit prompt. Grid edits autosave to rota_shifts immediately, so
// backing out is a real revert (RotaWorkspace snapshots the dept on entering
// edit and restores it here on discard). Offered when a HOD presses "Cancel"
// while an edit session is uncommitted: keep the changes (Save), throw them
// away (Discard), or stay in the grid (Keep editing).
//
// Mirrors HodEditConfirmModal's skin (.te-panel + .rest-popover-backdrop).

export default function CancelEditModal({ open, busy, onKeepEditing, onDiscard, onSave }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onKeepEditing?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onKeepEditing]);

  if (!open) return null;

  return (
    <>
      <div className="rest-popover-backdrop" onClick={busy ? undefined : onKeepEditing} />
      <div
        className="te-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-edit-title"
      >
        <div className="tp-header">
          <div>
            <div className="tp-eyebrow">Unsaved changes</div>
            <h2 className="tp-title" id="cancel-edit-title">
              Save your changes before leaving?
            </h2>
          </div>
          <button
            type="button"
            className="tp-close"
            aria-label="Keep editing"
            onClick={onKeepEditing}
            disabled={busy}
          ><X size={16} /></button>
        </div>

        <div className="te-body">
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#1C1B3A' }}>
            <b>Save changes</b> keeps your edits as a draft — you can publish or
            send them for acceptance when you’re ready.
          </p>
          <p style={{ margin: '12px 0 0', fontSize: 12, color: '#8B8478' }}>
            <b>Discard changes</b> throws away everything you edited this session
            and puts the rota back exactly as it was.
          </p>
        </div>

        <div className="te-footer">
          <button
            type="button"
            className="v2-btn-ghost"
            onClick={onDiscard}
            disabled={busy}
            aria-label="Discard changes"
          >{busy ? 'Discarding…' : 'Discard changes'}</button>
          <div className="te-footer-actions">
            <button
              type="button"
              className="v2-btn-ghost"
              onClick={onKeepEditing}
              disabled={busy}
              aria-label="Keep editing"
            >Keep editing</button>
            <button
              type="button"
              className="v2-btn-filled"
              onClick={onSave}
              disabled={busy}
              aria-label="Save changes"
            >Save changes</button>
          </div>
        </div>
      </div>
    </>
  );
}

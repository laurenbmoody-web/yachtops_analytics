import React, { useEffect } from 'react';
import { X } from 'lucide-react';

// HOD edit-while-non-draft confirmation. Fires only for HODs whose
// dept is currently in 'pending_approval' or 'published' state — both
// of which silently revert to 'draft' on the first edit per Phase 1's
// rota_department_status_hod_submit policy WITH CHECK clamp.
//
// CHIEF / COMMAND don't see this modal — they have the authority to
// move depts between states deliberately; the warning is for HODs who
// may not realise editing reverts the dept's status.
//
// Mirrors the rota track's existing modal pattern (.te-panel +
// .rest-popover-backdrop) — ModalShell isn't on this branch yet. When
// main is merged later, the modal can adopt ModalShell's dismiss
// scaffolding without changing the panel skin.

const STATUS_LABEL = {
  pending_approval: 'pending approval',
  published: 'published',
};

export default function HodEditConfirmModal({
  open, currentStatus, departmentName, onCancel, onContinue,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const statusCopy = STATUS_LABEL[currentStatus] || currentStatus || 'its current state';
  const deptCopy = departmentName || 'this department';

  return (
    <>
      <div className="rest-popover-backdrop" onClick={onCancel} />
      <div
        className="te-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hod-edit-confirm-title"
      >
        <div className="tp-header">
          <div>
            <div className="tp-eyebrow">Confirm</div>
            <h2 className="tp-title" id="hod-edit-confirm-title">
              Move <em>{deptCopy}</em> back to draft?
            </h2>
          </div>
          <button
            type="button"
            className="tp-close"
            aria-label="Close"
            onClick={onCancel}
          ><X size={16} /></button>
        </div>

        <div className="te-body">
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#1C1B3A' }}>
            Editing moves <b>{deptCopy}</b> from <em>{statusCopy}</em> back to draft —
            it’ll need approving again before it’s re-published.
          </p>
          <p style={{ margin: '12px 0 0', fontSize: 12, color: '#8B8478' }}>
            The crew keep seeing the current rota the whole time — nothing
            disappears. Only the shifts you change show as pending until a
            reviewer signs them off.
          </p>
        </div>

        <div className="te-footer">
          <span />
          <div className="te-footer-actions">
            <button
              type="button"
              className="v2-btn-ghost"
              onClick={onCancel}
              aria-label="Cancel"
            >Cancel</button>
            <button
              type="button"
              className="v2-btn-filled"
              onClick={onContinue}
              aria-label="Continue editing"
            >Continue editing</button>
          </div>
        </div>
      </div>
    </>
  );
}

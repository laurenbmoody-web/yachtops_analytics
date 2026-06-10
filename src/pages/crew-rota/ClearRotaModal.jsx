import React, { useEffect } from 'react';
import { X } from 'lucide-react';

// ClearRotaModal — COMMAND-only confirmation before wiping a rota's shifts.
// Mirrors HodEditConfirmModal's skin (.te-panel + .rest-popover-backdrop) so
// it sits consistently inside the rota track. Destructive + irreversible, so
// the confirm button is styled as a warning and the copy is explicit.

export default function ClearRotaModal({ open, busy, onCancel, onConfirm }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <>
      <div className="rest-popover-backdrop" onClick={busy ? undefined : onCancel} />
      <div
        className="te-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clear-rota-title"
      >
        <div className="tp-header">
          <div>
            <div className="tp-eyebrow">Confirm</div>
            <h2 className="tp-title" id="clear-rota-title">
              Clear <em>all shifts</em> on this rota?
            </h2>
          </div>
          <button
            type="button"
            className="tp-close"
            aria-label="Close"
            onClick={onCancel}
            disabled={busy}
          ><X size={16} /></button>
        </div>

        <div className="te-body">
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#1C1B3A' }}>
            This permanently deletes <b>every shift on this rota, across all
            departments</b> — draft and published alike. The grid is wiped back
            to a blank slate.
          </p>
          <p style={{ margin: '12px 0 0', fontSize: 12, color: '#8B8478' }}>
            This can’t be undone. Any department left mid-review can be cleared
            from the inbox with Reject.
          </p>
        </div>

        <div className="te-footer">
          <span />
          <div className="te-footer-actions">
            <button
              type="button"
              className="v2-btn-ghost"
              onClick={onCancel}
              disabled={busy}
              aria-label="Cancel"
            >Cancel</button>
            <button
              type="button"
              className="v2-btn-filled"
              style={{ background: '#7A2E1E' }}
              onClick={onConfirm}
              disabled={busy}
              aria-label="Clear all shifts on this rota"
            >{busy ? 'Clearing…' : 'Clear rota'}</button>
          </div>
        </div>
      </div>
    </>
  );
}

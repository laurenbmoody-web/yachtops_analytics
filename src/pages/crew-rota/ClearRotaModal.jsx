import React, { useEffect } from 'react';
import { X } from 'lucide-react';

// ClearRotaModal — COMMAND-only confirmation before wiping shifts. Offers two
// scopes: just the viewed day, or the entire rota. Mirrors HodEditConfirmModal's
// skin (.te-panel + .rest-popover-backdrop). Destructive + irreversible.

export default function ClearRotaModal({ open, busy, dateLabel, onCancel, onClearDay, onClearAll }) {
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
              Clear <em>shifts</em>?
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
            Choose what to delete. This can’t be undone.
          </p>
          <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 12, color: '#8B8478', lineHeight: 1.6 }}>
            <li><b>This day</b> — every shift on {dateLabel || 'the selected day'}, across all departments.</li>
            <li><b>Entire rota</b> — every shift on this rota, all days and departments.</li>
          </ul>
          <p style={{ margin: '12px 0 0', fontSize: 12, color: '#8B8478' }}>
            Any department left mid-review can be cleared from the inbox with Reject.
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
              className="v2-btn-ghost"
              style={{ color: '#7A2E1E', borderColor: 'rgba(122,46,30,0.3)' }}
              onClick={onClearDay}
              disabled={busy}
              aria-label={`Clear all shifts on ${dateLabel || 'this day'}`}
            >{busy === 'day' ? 'Clearing…' : 'Clear this day'}</button>
            <button
              type="button"
              className="v2-btn-filled"
              style={{ background: '#7A2E1E' }}
              onClick={onClearAll}
              disabled={busy}
              aria-label="Clear the entire rota"
            >{busy === 'all' ? 'Clearing…' : 'Clear entire rota'}</button>
          </div>
        </div>
      </div>
    </>
  );
}

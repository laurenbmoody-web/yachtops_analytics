// Styled replacement for window.confirm — the browser popup reads as
// unfinished in a premium product. Esc cancels, backdrop click cancels,
// confirm button autofocuses so Enter confirms.
import React, { useEffect, useRef } from 'react';
import './product-modal.css';

const ConfirmDialog = ({ title, body, confirmLabel = 'Delete', danger = true, busy = false, onConfirm, onCancel }) => {
  const confirmRef = useRef(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="spm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="spc-panel" role="alertdialog" aria-label={title}>
        <h4 className="spc-title">{title}</h4>
        <p className="spc-body">{body}</p>
        <div className="spc-actions">
          <button type="button" className="spc-btn ghost" onClick={onCancel}>Cancel</button>
          <button
            ref={confirmRef}
            type="button"
            className={`spc-btn ${danger ? 'danger' : ''}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;

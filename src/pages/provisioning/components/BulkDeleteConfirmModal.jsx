import React from 'react';
import ModalShell from '../../../components/ui/ModalShell';

/**
 * Bulk-delete confirmation modal.
 *
 * Surfaces a short prompt before the action bar's Delete fires. Cancel
 * dismisses; Delete commits the bulk delete. Tiny by design — no item
 * preview, no "Don't show again" toggle, no granular re-selection. The
 * user already picked the items; this is the safety gate.
 *
 * Cool-surface palette via .pv-dashboard scope on the panel root.
 */
const BulkDeleteConfirmModal = ({
  isOpen,
  count,
  busy = false,
  onCancel,
  onConfirm,
}) => {
  if (!isOpen) return null;

  return (
    <ModalShell
      onClose={busy ? () => {} : onCancel}
      isBusy={busy}
      panelClassName="pv-dashboard"
      panelStyle={{
        background: 'var(--d-card)',
        border: '1px solid var(--d-border)',
        borderBottom: '5px solid var(--d-card-edge)',
        borderRadius: 12,
        boxShadow: '0 24px 64px rgba(38, 42, 83, 0.18)',
        width: '100%',
        maxWidth: 440,
        padding: '24px 24px 18px',
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
      }}
    >
      <h2
        style={{
          margin: 0,
          fontFamily: "'DM Serif Display', Georgia, serif",
          fontSize: 20,
          color: 'var(--d-navy-deep)',
          letterSpacing: '-0.01em',
        }}
      >
        Delete {count} item{count === 1 ? '' : 's'}?
      </h2>
      <p
        style={{
          margin: '8px 0 22px',
          fontSize: 13,
          color: 'var(--d-muted)',
          lineHeight: 1.45,
        }}
      >
        This can't be undone.
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          style={{
            padding: '8px 16px',
            fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--d-navy)',
            background: 'var(--d-card)',
            border: '1px solid var(--d-border)',
            borderRadius: 8,
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.55 : 1,
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          style={{
            padding: '8px 16px',
            fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: 600,
            color: 'white',
            background: 'var(--d-danger)',
            border: '0',
            borderRadius: 8,
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.55 : 1,
          }}
        >
          {busy ? 'Deleting…' : `Delete ${count} item${count === 1 ? '' : 's'}`}
        </button>
      </div>
    </ModalShell>
  );
};

export default BulkDeleteConfirmModal;

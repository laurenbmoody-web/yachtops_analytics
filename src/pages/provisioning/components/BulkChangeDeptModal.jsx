import React, { useState, useEffect } from 'react';
import ModalShell from '../../../components/ui/ModalShell';

/**
 * Bulk change-department modal.
 *
 * Tiny by design — single inline <select> over the departments array
 * the parent already loaded, Cancel + Change buttons. No extracted
 * DeptPicker component (no second consumer; the brief explicitly says
 * keep it inline).
 *
 * Initial dept selection: empty (user has to make an active choice).
 * The Change button stays disabled until a value is picked, so a
 * misclick can't silently overwrite to ''.
 *
 * Cool-surface palette via .pv-dashboard scope on the panel root.
 */
const BulkChangeDeptModal = ({
  isOpen,
  count,
  departments = [],
  busy = false,
  onCancel,
  onConfirm,
}) => {
  const [dept, setDept] = useState('');

  // Reset the picker each time the modal opens — otherwise a previous
  // session's choice would persist and the user might overwrite without
  // realising. Stable across the open lifecycle so typing isn't lost.
  useEffect(() => {
    if (isOpen) setDept('');
  }, [isOpen]);

  if (!isOpen) return null;

  const canSubmit = !!dept && !busy;

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
        Change department for {count} item{count === 1 ? '' : 's'}
      </h2>
      <p
        style={{
          margin: '8px 0 18px',
          fontSize: 12.5,
          color: 'var(--d-muted)',
          lineHeight: 1.45,
        }}
      >
        Pick the new department. Selected items will reassign immediately.
      </p>

      {/* Inline dept picker — single <select>, no extracted component
          per investigation answer 5. */}
      <label
        style={{
          display: 'block',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
          color: 'var(--d-muted-soft)',
          marginBottom: 6,
        }}
        htmlFor="bulk-change-dept-select"
      >
        Department
      </label>
      <select
        id="bulk-change-dept-select"
        value={dept}
        onChange={(e) => setDept(e.target.value)}
        disabled={busy}
        autoFocus
        style={{
          width: '100%',
          padding: '8px 10px',
          fontFamily: 'inherit',
          fontSize: 13.5,
          color: 'var(--d-navy)',
          background: 'var(--d-card)',
          border: '1px solid var(--d-border)',
          borderRadius: 8,
          outline: 'none',
          cursor: busy ? 'default' : 'pointer',
          marginBottom: 22,
        }}
      >
        <option value="" disabled>Select a department…</option>
        {departments.map((d) => (
          <option key={d.id || d.name} value={d.name}>{d.name}</option>
        ))}
      </select>

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
          onClick={() => onConfirm(dept)}
          disabled={!canSubmit}
          style={{
            padding: '8px 16px',
            fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: 600,
            color: 'white',
            background: canSubmit ? 'var(--d-orange)' : 'var(--d-border)',
            border: '0',
            borderRadius: 8,
            cursor: canSubmit ? 'pointer' : 'default',
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? 'Changing…' : `Change ${count} item${count === 1 ? '' : 's'}`}
        </button>
      </div>
    </ModalShell>
  );
};

export default BulkChangeDeptModal;

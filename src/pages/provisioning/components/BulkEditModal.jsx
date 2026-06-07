import React, { useState, useEffect } from 'react';
import ModalShell from '../../../components/ui/ModalShell';
import SupplierPicker from './SupplierPicker';
import { UNIT_GROUPS } from './DetailTableCells';
import { fetchVendors } from '../utils/provisioningStorage';

/**
 * Bulk multi-edit modal — items-list selection model commit 4.
 *
 * Field set (7, not the brief's 8):
 *   Quantity, Unit, Status, Department, Supplier, Unit cost, Notes
 *
 * The brief listed "Estimated price" separately from "Unit cost" but
 * provisioning_items has a single estimated_unit_cost column and no
 * computed total-price field. "Estimated price" reads as a synonym in
 * this schema; dropping the apparent duplicate. If a separate field is
 * intended, flag and we'll resurrect.
 *
 * Behaviour
 *   - Initial value per field derived from selectedItemRows when the
 *     modal opens. If all selected items agree on a value, the field
 *     shows that value. If they differ, the field shows empty with
 *     a "Multiple values" placeholder.
 *   - Touched flag per field. Save writes ONLY touched fields —
 *     untouched fields are NOT written (otherwise opening + saving
 *     with no changes would blank every field on every selected item).
 *   - Save button disabled when nothing is touched; bar shows
 *     "No changes" toast and closes if the user clicks anyway.
 *   - Status = 'received' routes through the parent's bulk-receive
 *     path (serialised quickReceiveItem loop with bar's progress
 *     indicator). Other status values + non-status fields go through
 *     a single upsertItems write.
 *
 * Layout mirrors ItemDrawer's pattern (mostly single-column with
 * one paired Qty/Unit row at the top, matching idr-measure-grid).
 */

const STATUS_OPTIONS = [
  { value: 'draft',        label: 'Draft' },
  { value: 'to_order',     label: 'To order' },
  { value: 'ordered',      label: 'Ordered' },
  { value: 'received',     label: 'Received' },
  { value: 'partial',      label: 'Partial' },
  { value: 'not_received', label: 'Not received' },
];

const FIELDS = [
  'quantity_ordered',
  'unit',
  'status',
  'department',
  'supplier_profile_id',
  'estimated_unit_cost',
  'notes',
];

const LABEL_STYLE = {
  display: 'block',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
  color: 'var(--d-muted-soft)',
  marginBottom: 6,
};

const BulkEditModal = ({
  isOpen,
  count,
  selectedItemRows = [],
  departments = [],
  busy = false,
  onCancel,
  onConfirm,
}) => {
  const [values, setValues] = useState({});
  const [touched, setTouched] = useState({});
  const [placeholders, setPlaceholders] = useState({});
  const [suppliers, setSuppliers] = useState([]);

  // Derive initial state when the modal opens. Captures a snapshot of
  // the current selection; downstream changes to selectedItemRows
  // don't re-derive until the user closes + reopens the modal (intended
  // — they're mid-edit; we don't want fields jumping under them).
  useEffect(() => {
    if (!isOpen) return;

    const initialValues = {};
    const initialPlaceholders = {};
    FIELDS.forEach((key) => {
      const distinct = new Set(selectedItemRows.map((i) => i?.[key] ?? ''));
      if (distinct.size === 1) {
        const [only] = [...distinct];
        initialValues[key] = only ?? '';
        initialPlaceholders[key] = '';
      } else {
        initialValues[key] = '';
        initialPlaceholders[key] = 'Multiple values';
      }
    });
    setValues(initialValues);
    setTouched({});
    setPlaceholders(initialPlaceholders);

    // Fetch suppliers once per open. Mirrors ItemDrawer's pattern.
    let cancelled = false;
    fetchVendors().then(({ data }) => {
      if (!cancelled) setSuppliers(data || []);
    }).catch((err) => {
      console.error('[BulkEdit] fetchVendors error:', err);
    });
    return () => { cancelled = true; };
    // selectedItemRows intentionally omitted — snapshot at open time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const setField = (key, val) => {
    setValues((v) => ({ ...v, [key]: val }));
    setTouched((t) => ({ ...t, [key]: true }));
  };

  if (!isOpen) return null;

  const anyTouched = Object.values(touched).some(Boolean);
  const canSubmit = anyTouched && !busy;

  const handleSave = () => {
    // Build the diff: only fields the user touched.
    const diff = {};
    FIELDS.forEach((key) => {
      if (touched[key]) diff[key] = values[key];
    });
    // Supplier maps to two columns (profile id + display name) so the
    // parent's write path knows what to do. Resolve the name here
    // from the supplier list — saves the parent from looking it up.
    if (touched.supplier_profile_id) {
      const profile = suppliers.find((s) => s.id === values.supplier_profile_id);
      diff.supplier_name = profile?.name || '';
    }
    onConfirm({ diff, touched });
  };

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
        maxWidth: 520,
        maxHeight: '88vh',
        overflowY: 'auto',
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
        Edit {count} item{count === 1 ? '' : 's'}
      </h2>
      <p style={{ margin: '8px 0 18px', fontSize: 12.5, color: 'var(--d-muted)', lineHeight: 1.45 }}>
        Only the fields you change are written. Fields you leave alone keep their existing values.
      </p>

      {/* Row 1 — Quantity + Unit (mirrors ItemDrawer's MEASURE grid) */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr', gap: 8, marginBottom: 12 }}>
        <div>
          <label style={LABEL_STYLE} htmlFor="bem-qty">Quantity</label>
          <input
            id="bem-qty"
            type="number"
            min="0"
            step="0.1"
            value={values.quantity_ordered ?? ''}
            onChange={(e) => setField('quantity_ordered', e.target.value)}
            placeholder={placeholders.quantity_ordered}
            disabled={busy}
            className="pv-bulk-edit-input"
          />
        </div>
        <div>
          <label style={LABEL_STYLE} htmlFor="bem-unit">Unit</label>
          <select
            id="bem-unit"
            value={values.unit ?? ''}
            onChange={(e) => setField('unit', e.target.value)}
            disabled={busy}
            className="pv-bulk-edit-input"
          >
            <option value="">{placeholders.unit || '— select —'}</option>
            {UNIT_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      {/* Status */}
      <div style={{ marginBottom: 12 }}>
        <label style={LABEL_STYLE} htmlFor="bem-status">Status</label>
        <select
          id="bem-status"
          value={values.status ?? ''}
          onChange={(e) => setField('status', e.target.value)}
          disabled={busy}
          className="pv-bulk-edit-input"
        >
          <option value="">{placeholders.status || '— select —'}</option>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Department */}
      <div style={{ marginBottom: 12 }}>
        <label style={LABEL_STYLE} htmlFor="bem-dept">Department</label>
        <select
          id="bem-dept"
          value={values.department ?? ''}
          onChange={(e) => setField('department', e.target.value)}
          disabled={busy}
          className="pv-bulk-edit-input"
        >
          <option value="">{placeholders.department || '— select —'}</option>
          {departments.map((d) => (
            <option key={d.id || d.name} value={d.name}>{d.name}</option>
          ))}
        </select>
      </div>

      {/* Supplier */}
      <div style={{ marginBottom: 12 }}>
        <label style={LABEL_STYLE}>Supplier</label>
        <SupplierPicker
          value={values.supplier_profile_id ?? ''}
          suppliers={suppliers}
          disabled={busy}
          placeholder={placeholders.supplier_profile_id || 'No supplier'}
          inputClassName="pv-bulk-edit-input"
          onChange={(profile) => {
            setValues((v) => ({ ...v, supplier_profile_id: profile?.id ?? '' }));
            setTouched((t) => ({ ...t, supplier_profile_id: true }));
          }}
        />
      </div>

      {/* Unit cost */}
      <div style={{ marginBottom: 12 }}>
        <label style={LABEL_STYLE} htmlFor="bem-cost">Unit cost</label>
        <input
          id="bem-cost"
          type="number"
          min="0"
          step="0.01"
          value={values.estimated_unit_cost ?? ''}
          onChange={(e) => setField('estimated_unit_cost', e.target.value)}
          placeholder={placeholders.estimated_unit_cost || '0.00'}
          disabled={busy}
          className="pv-bulk-edit-input"
        />
      </div>

      {/* Notes */}
      <div style={{ marginBottom: 22 }}>
        <label style={LABEL_STYLE} htmlFor="bem-notes">Notes</label>
        <textarea
          id="bem-notes"
          rows={2}
          value={values.notes ?? ''}
          onChange={(e) => setField('notes', e.target.value)}
          placeholder={placeholders.notes}
          disabled={busy}
          className="pv-bulk-edit-input"
        />
      </div>

      {/* Footer */}
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
          onClick={handleSave}
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
          {busy ? 'Saving…' : `Save ${count} item${count === 1 ? '' : 's'}`}
        </button>
      </div>
    </ModalShell>
  );
};

export default BulkEditModal;

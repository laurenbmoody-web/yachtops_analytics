import React, { useEffect, useState } from 'react';
import SupplierModal from './SupplierModal';
import { updateOrderDelivery } from '../utils/supplierStorage';

const EMPTY_FORM = {
  delivery_date: '',
  delivery_time: '',
  delivery_port: '',
  delivery_contact: '',
  special_instructions: '',
};

const formFromOrder = (order) => ({
  delivery_date:        order?.delivery_date ?? '',
  delivery_time:        order?.delivery_time ?? '',
  delivery_port:        order?.delivery_port ?? '',
  delivery_contact:     order?.delivery_contact ?? '',
  special_instructions: order?.special_instructions ?? '',
});

export default function EditDeliveryModal({ order, open, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Re-seed the form whenever the modal is opened against a (possibly fresh) order.
  useEffect(() => {
    if (open && order) {
      setForm(formFromOrder(order));
      setError(null);
    }
  }, [open, order]);

  const set = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateOrderDelivery(order.id, form);
      onSaved?.(updated);
      onClose();
    } catch (e) {
      setError(e.message || 'Could not save changes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SupplierModal
      open={open}
      onClose={onClose}
      title="Edit delivery"
      footer={
        <>
          <button type="button" className="sp-btn sp-btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="sp-btn sp-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      {error && (
        <div style={{
          marginBottom: 14, padding: '8px 12px',
          background: '#FEF2F2', border: '1px solid #FECACA',
          borderRadius: 7, color: '#991B1B', fontSize: 12.5,
        }}>{error}</div>
      )}

      <div className="sp-field-row">
        <div className="sp-field">
          <label className="sp-field-label">Date</label>
          <input
            type="date"
            className="sp-field-input"
            value={form.delivery_date}
            onChange={set('delivery_date')}
            disabled={saving}
          />
        </div>
        <div className="sp-field">
          <label className="sp-field-label">Time</label>
          <input
            type="time"
            className="sp-field-input"
            value={form.delivery_time}
            onChange={set('delivery_time')}
            disabled={saving}
          />
        </div>
      </div>

      <div className="sp-field">
        <label className="sp-field-label">Location / Port</label>
        <input
          type="text"
          className="sp-field-input"
          placeholder="e.g. STP · Marina IGY · Slip B7"
          value={form.delivery_port}
          onChange={set('delivery_port')}
          disabled={saving}
        />
      </div>

      <div className="sp-field">
        <label className="sp-field-label">Dock contact</label>
        <input
          type="text"
          className="sp-field-input"
          placeholder="e.g. Bosun David Klein +33 6 xx xx 47 22"
          value={form.delivery_contact}
          onChange={set('delivery_contact')}
          disabled={saving}
        />
      </div>

      <div className="sp-field">
        <label className="sp-field-label">Special instructions</label>
        <textarea
          className="sp-field-textarea"
          placeholder="Any special handling notes…"
          value={form.special_instructions}
          onChange={set('special_instructions')}
          disabled={saving}
        />
      </div>
    </SupplierModal>
  );
}

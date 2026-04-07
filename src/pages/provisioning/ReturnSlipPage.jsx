import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';

const REASON_OPTIONS = [
  'Not ordered',
  'Overage',
  'Damaged',
  'Wrong item',
  'Incorrect specification',
  'Other',
];

const fmtCurrency = (val) => {
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
};

const Field = ({ label, value, onChange, type = 'text', multiline = false }) => (
  <div>
    <label style={{ display: 'block', fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>{label}</label>
    {multiline ? (
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={2}
        style={{
          width: '100%', border: '1px solid #E2E8F0', borderRadius: 6,
          padding: '6px 10px', fontSize: 13, color: '#0F172A', resize: 'vertical',
          fontFamily: 'inherit', boxSizing: 'border-box',
        }}
      />
    ) : (
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', border: '1px solid #E2E8F0', borderRadius: 6,
          padding: '6px 10px', fontSize: 13, color: '#0F172A',
          fontFamily: 'inherit', boxSizing: 'border-box',
        }}
      />
    )}
  </div>
);

export default function ReturnSlipPage() {
  const { authUser } = useAuth();
  const { tenantId } = useTenant();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [vessel, setVessel] = useState(null);
  const [items, setItems] = useState([]);
  const [supplierInfo, setSupplierInfo] = useState({ name: '', phone: '', email: '', address: '' });
  const [orderMeta, setOrderMeta] = useState({ ref: '', date: '', noteUrl: '', noteRef: '' });
  const [preparedBy, setPreparedBy] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const itemIds = (params.get('items') || '').split(',').filter(Boolean);
    if (!itemIds.length) { setLoading(false); return; }

    (async () => {
      // Fetch inbox items
      const { data: rows } = await supabase
        ?.from('delivery_inbox')
        ?.select('*')
        ?.in('id', itemIds);

      if (rows?.length) {
        const first = rows[0];
        setSupplierInfo({
          name:    first.supplier_name    || '',
          phone:   first.supplier_phone   || '',
          email:   first.supplier_email   || '',
          address: first.supplier_address || '',
        });
        setOrderMeta({
          ref:     first.order_ref          || '',
          date:    first.order_date         || '',
          noteUrl: first.delivery_note_url  || '',
          noteRef: first.delivery_note_ref  || '',
        });
        // Pre-populate from saved DB values when reopening a slip
        setItems(rows.map(item => ({
          ...item,
          return_qty:    item.return_qty    ?? item.quantity ?? 1,
          return_reason: item.return_reason ?? 'Not ordered',
          return_notes:  item.return_notes  ?? '',
        })));
        setSaved(rows.some(i => i.return_slip_generated_at != null));
      }

      // Fetch vessel
      const tid = tenantId || rows?.[0]?.tenant_id;
      if (tid) {
        const { data: v } = await supabase
          ?.from('vessels')
          ?.select('vessel_type_label, imo_number, flag, port_of_registry, official_number, loa_m, gt')
          ?.eq('tenant_id', tid)
          ?.single();
        setVessel(v);
      }

      // Prepared by
      if (authUser?.id) {
        const { data: profile } = await supabase
          ?.from('profiles')
          ?.select('full_name')
          ?.eq('id', authUser.id)
          ?.single();
        setPreparedBy(profile?.full_name || '');
      }

      setLoading(false);
    })();
  }, [authUser?.id, tenantId]);

  const updateItem = (id, field, value) => {
    setItems(prev => prev.map(i => (i.id === id ? { ...i, [field]: value } : i)));
    setSaved(false);
  };

  const saveChanges = async () => {
    setSaving(true);
    const now = new Date().toISOString();
    const userId = authUser?.id || null;
    await Promise.all(items.map(item =>
      supabase?.from('delivery_inbox')?.update({
        return_qty:                  item.return_qty,
        return_reason:               item.return_reason,
        return_notes:                item.return_notes || null,
        return_slip_generated_at:    now,
        return_slip_generated_by:    userId,
      })?.eq('id', item.id)
    ));
    setSaving(false);
    setSaved(true);
  };

  const handlePrint = async () => {
    await saveChanges();
    window.print();
  };

  const total = items.reduce((sum, i) => sum + (parseFloat(i.line_total) || 0), 0);
  const showPricing = items.some(i => i.unit_price || i.line_total);
  const showRef     = items.some(i => i.item_reference);
  const showOrdered = items.some(i => i.ordered_qty != null);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#94A3B8', fontSize: 14 }}>
        Loading return slip…
      </div>
    );
  }

  if (!items.length) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#94A3B8', fontSize: 14 }}>
        No items found. Close this tab and try again.
      </div>
    );
  }

  // ── Shared inline styles ───────────────────────────────────────────────────
  const card = { background: '#F8FAFC', borderRadius: 8, padding: '14px 16px', marginBottom: 20 };
  const th   = { textAlign: 'left', padding: '7px 10px', fontWeight: 600, fontSize: 12, color: '#475569', borderBottom: '2px solid #E2E8F0' };
  const td   = { padding: '8px 10px', fontSize: 13, borderBottom: '1px solid #F1F5F9', verticalAlign: 'middle' };

  return (
    <>
      {/* Print-only hides edit controls */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-val { border: none !important; background: transparent !important; padding: 0 !important; }
          body { margin: 0; }
        }
        @page { size: A4; margin: 20mm; }
      `}</style>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '40px 32px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', color: '#0F172A' }}>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#1E3A5F' }}>Return Slip</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748B' }}>
              {vessel?.vessel_type_label || 'Vessel'}
              {vessel?.imo_number ? ` · IMO: ${vessel.imo_number}` : ''}
            </p>
          </div>
          <div style={{ textAlign: 'right', fontSize: 12, color: '#64748B' }}>
            <p style={{ margin: 0 }}>Date: {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            {preparedBy && <p style={{ margin: '4px 0 0' }}>Prepared by: {preparedBy}</p>}
          </div>
        </div>

        {/* ── Vessel info (read-only) ──────────────────────────────────── */}
        {vessel && (
          <div style={{ ...card, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', fontSize: 12, color: '#334155' }}>
            <div><span style={{ color: '#94A3B8' }}>Flag: </span>{vessel.flag || '—'}</div>
            <div><span style={{ color: '#94A3B8' }}>Official Number: </span>{vessel.official_number || '—'}</div>
            <div><span style={{ color: '#94A3B8' }}>Port of Registry: </span>{vessel.port_of_registry || '—'}</div>
            <div><span style={{ color: '#94A3B8' }}>LOA: </span>{vessel.loa_m ? `${vessel.loa_m}m` : '—'}</div>
            <div><span style={{ color: '#94A3B8' }}>IMO Number: </span>{vessel.imo_number || '—'}</div>
            <div><span style={{ color: '#94A3B8' }}>Gross Tonnage: </span>{vessel.gt || '—'}</div>
          </div>
        )}

        {/* ── Supplier info (editable) ─────────────────────────────────── */}
        <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, padding: '14px 16px', marginBottom: 20 }}>
          <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Supplier Details
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Company Name" value={supplierInfo.name}    onChange={v => setSupplierInfo(p => ({ ...p, name: v }))} />
            <Field label="Phone"        value={supplierInfo.phone}   onChange={v => setSupplierInfo(p => ({ ...p, phone: v }))} />
            <Field label="Email"        value={supplierInfo.email}   onChange={v => setSupplierInfo(p => ({ ...p, email: v }))} />
            <Field label="Address"      value={supplierInfo.address} onChange={v => setSupplierInfo(p => ({ ...p, address: v }))} />
          </div>
        </div>

        {/* ── Order reference ──────────────────────────────────────────── */}
        {(orderMeta.ref || orderMeta.date || orderMeta.noteRef || orderMeta.noteUrl) && (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12, color: '#475569', marginBottom: 20 }}>
            {orderMeta.ref     && <span><strong>Order Ref:</strong> {orderMeta.ref}</span>}
            {orderMeta.date    && <span><strong>Order Date:</strong> {orderMeta.date}</span>}
            {orderMeta.noteRef && <span><strong>Delivery Note Ref:</strong> {orderMeta.noteRef}</span>}
            {orderMeta.noteUrl && (
              <a href={orderMeta.noteUrl} target="_blank" rel="noreferrer"
                style={{ color: '#1E3A5F', textDecoration: 'underline' }}>
                View original delivery note ↗
              </a>
            )}
          </div>
        )}

        {/* ── Items table (editable) ───────────────────────────────────── */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 28 }}>
          <thead>
            <tr>
              {showRef     && <th style={th}>Ref</th>}
              <th style={th}>Description</th>
              {showOrdered && <th style={{ ...th, textAlign: 'center', width: 70 }}>Ordered</th>}
              <th style={{ ...th, textAlign: 'center', width: 70 }}>Delivered</th>
              <th style={{ ...th, textAlign: 'center', width: 90 }}>Return Qty</th>
              {showPricing && <th style={{ ...th, textAlign: 'right', width: 90 }}>Unit Price</th>}
              {showPricing && <th style={{ ...th, textAlign: 'right', width: 90 }}>Total</th>}
              <th style={{ ...th, width: 140 }}>Reason</th>
              <th style={th}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id}>
                {showRef && (
                  <td style={{ ...td, color: '#94A3B8', fontSize: 11 }}>{item.item_reference || '—'}</td>
                )}
                <td style={td}>{item.raw_name}</td>
                {showOrdered && (
                  <td style={{ ...td, textAlign: 'center', color: '#64748B' }}>{item.ordered_qty ?? '—'}</td>
                )}
                <td style={{ ...td, textAlign: 'center' }}>{item.quantity ?? '—'}{item.unit ? ` ${item.unit}` : ''}</td>
                <td style={{ ...td, textAlign: 'center' }}>
                  <input
                    className="print-val"
                    type="number"
                    value={item.return_qty}
                    onChange={e => updateItem(item.id, 'return_qty', Math.max(1, Math.min(item.quantity, parseInt(e.target.value) || 1)))}
                    min={1}
                    max={item.quantity}
                    style={{
                      width: 60, border: '1px solid #E2E8F0', borderRadius: 6,
                      padding: '4px 6px', textAlign: 'center', fontSize: 13,
                    }}
                  />
                </td>
                {showPricing && <td style={{ ...td, textAlign: 'right', color: '#475569' }}>{fmtCurrency(item.unit_price)}</td>}
                {showPricing && <td style={{ ...td, textAlign: 'right', fontWeight: 500 }}>{fmtCurrency(item.line_total)}</td>}
                <td style={td}>
                  <select
                    className="print-val"
                    value={item.return_reason}
                    onChange={e => updateItem(item.id, 'return_reason', e.target.value)}
                    style={{
                      width: '100%', border: '1px solid #E2E8F0', borderRadius: 6,
                      padding: '4px 8px', fontSize: 12, background: 'white',
                    }}
                  >
                    {REASON_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td style={td}>
                  <input
                    className="print-val"
                    type="text"
                    value={item.return_notes}
                    onChange={e => updateItem(item.id, 'return_notes', e.target.value)}
                    placeholder="Optional…"
                    style={{
                      width: '100%', border: '1px solid #E2E8F0', borderRadius: 6,
                      padding: '4px 8px', fontSize: 12, boxSizing: 'border-box',
                    }}
                  />
                </td>
              </tr>
            ))}
            {showPricing && total > 0 && (
              <tr style={{ background: '#F8FAFC' }}>
                <td colSpan={(showRef ? 1 : 0) + 1 + (showOrdered ? 1 : 0) + 1 + 1 + 1}
                  style={{ ...td, textAlign: 'right', fontWeight: 600, borderTop: '2px solid #E2E8F0' }}>
                  Total
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, borderTop: '2px solid #E2E8F0' }}>
                  {fmtCurrency(total)}
                </td>
                <td colSpan={2} style={{ ...td, borderTop: '2px solid #E2E8F0' }} />
              </tr>
            )}
          </tbody>
        </table>

        {/* ── Signature lines ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 60, marginTop: 48, paddingTop: 16, borderTop: '1px solid #E2E8F0' }}>
          {[['Vessel authorisation', 'Name, signature & date'], ['Supplier acknowledgement', 'Name, signature & date']].map(([label, sub]) => (
            <div key={label} style={{ flex: 1, maxWidth: 220 }}>
              <div style={{ height: 48, borderBottom: '1px solid #CBD5E1', marginBottom: 8 }} />
              <p style={{ margin: 0, fontSize: 12, color: '#64748B' }}>{label}</p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94A3B8' }}>{sub}</p>
            </div>
          ))}
        </div>

        {/* ── Action buttons ───────────────────────────────────────────── */}
        <div className="no-print" style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 32 }}>
          <button
            onClick={saveChanges}
            disabled={saving}
            style={{
              padding: '10px 24px', background: 'white', color: '#0F172A',
              border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, fontWeight: 500,
              cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Changes'}
          </button>
          <button
            onClick={handlePrint}
            disabled={saving}
            style={{
              padding: '10px 28px', background: '#1E3A5F', color: 'white',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
              cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save & Print'}
          </button>
        </div>

      </div>
    </>
  );
}

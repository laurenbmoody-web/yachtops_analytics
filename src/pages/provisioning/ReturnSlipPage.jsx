import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';

const REASON_OPTIONS = [
  'Not ordered',
  'Oversupply',
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

// ── Signature pad (draw-to-sign canvas) ──────────────────────────────────────

const SignaturePad = ({ label, sublabel, onSign }) => {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const touch = e.touches?.[0];
    const clientX = touch ? touch.clientX : e.clientX;
    const clientY = touch ? touch.clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const startDraw = useCallback((e) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setDrawing(true);
  }, []);

  const draw = useCallback((e) => {
    if (!drawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#1E3A5F';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    setHasStrokes(true);
  }, [drawing]);

  const endDraw = useCallback(() => {
    setDrawing(false);
    if (hasStrokes && canvasRef.current) {
      onSign?.(canvasRef.current.toDataURL('image/png'));
    }
  }, [hasStrokes, onSign]);

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStrokes(false);
    onSign?.(null);
  };

  return (
    <div style={{ flex: 1, maxWidth: 280 }}>
      <div style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          width={280}
          height={80}
          style={{
            width: '100%', height: 80, borderBottom: '1px solid #CBD5E1',
            cursor: 'crosshair', touchAction: 'none',
          }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        {!hasStrokes && (
          <span style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            fontSize: 11, color: '#CBD5E1', pointerEvents: 'none', userSelect: 'none',
          }}>
            Sign here
          </span>
        )}
        {hasStrokes && (
          <button
            className="no-print"
            onClick={clear}
            style={{
              position: 'absolute', top: 4, right: 4, background: 'none', border: 'none',
              fontSize: 10, color: '#94A3B8', cursor: 'pointer', padding: '2px 6px',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#DC2626'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#94A3B8'; }}
          >
            Clear
          </button>
        )}
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 12, color: '#64748B' }}>{label}</p>
      <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94A3B8' }}>{sublabel}</p>
    </div>
  );
};

export default function ReturnSlipPage() {
  const { authUser } = useAuth();
  const { tenantId } = useTenant();

  const [loading, setLoading] = useState(true);
  const [vessel, setVessel] = useState(null);
  const [vesselName, setVesselName] = useState('');
  const [items, setItems] = useState([]);
  const [supplierInfo, setSupplierInfo] = useState({ name: '', phone: '', email: '', address: '' });
  const [orderMeta, setOrderMeta] = useState({ ref: '', date: '', noteUrl: '', noteRef: '' });
  const [preparedBy, setPreparedBy] = useState('');
  const [signerJobTitle, setSignerJobTitle] = useState('');
  const [slipDate, setSlipDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // null | 'saved' | 'error'
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [vesselSig, setVesselSig] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState(null);

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
        setItems(rows.map(item => ({
          ...item,
          return_qty:    item.return_qty    ?? item.quantity ?? 1,
          return_reason: item.return_reason ?? 'Not ordered',
          return_notes:  item.return_notes  ?? '',
        })));

        // Derive slip date from return_requested_at of first item, fall back to today
        const rawDate = first.return_requested_at ? new Date(first.return_requested_at) : new Date();
        setSlipDate(rawDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }));

        // If any item already has saved return slip data, show last-saved indicator
        const lastGen = rows
          .map(r => r.return_slip_generated_at)
          .filter(Boolean)
          .sort()
          .pop();
        if (lastGen) setLastSavedAt(new Date(lastGen));
      }

      // Fetch vessel + tenant name
      const tid = tenantId || rows?.[0]?.tenant_id;
      if (tid) {
        const [{ data: v }, { data: tenant }] = await Promise.all([
          supabase?.from('vessels')?.select('imo_number, flag')?.eq('tenant_id', tid)?.single(),
          supabase?.from('tenants')?.select('name')?.eq('id', tid)?.single(),
        ]);
        setVessel(v);
        setVesselName(tenant?.name || '');
      }

      // Prepared by
      if (authUser?.id) {
        const { data: profile } = await supabase
          ?.from('profiles')
          ?.select('full_name, job_title')
          ?.eq('id', authUser.id)
          ?.single();
        setPreparedBy(profile?.full_name || '');
        setSignerJobTitle(profile?.job_title || '');
      }

      setLoading(false);
    })();
  }, [authUser?.id, tenantId]);

  const updateItem = (id, field, value) => {
    setItems(prev => prev.map(i => (i.id === id ? { ...i, [field]: value } : i)));
    setDirty(true);
    setSaveStatus(null);
  };

  const saveChanges = async () => {
    setSaving(true);
    setSaveStatus(null);
    const now = new Date().toISOString();
    let failed = 0;
    for (const item of items) {
      const { error } = await supabase
        ?.from('delivery_inbox')
        ?.update({
          return_qty:               item.return_qty,
          return_reason:            item.return_reason,
          return_notes:             item.return_notes || null,
          return_slip_generated_at: now,
          return_slip_generated_by: authUser?.id || null,
        })
        ?.eq('id', item.id);
      if (error) {
        console.error('[ReturnSlip] save error for', item.id, error);
        failed++;
      }
    }
    setSaving(false);
    if (failed === 0) {
      setSaveStatus('saved');
      setDirty(false);
      setLastSavedAt(new Date(now));
    } else {
      setSaveStatus('error');
    }
  };

  const handleSaveAndPrint = async () => {
    await saveChanges();
    // Small delay so the save status renders before print dialog
    setTimeout(() => window.print(), 200);
  };

  const handleSubmitToSupplier = async () => {
    if (!supplierInfo.email) return;
    await saveChanges();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data, error } = await supabase.functions.invoke('sendReturnSlip', {
        body: {
          to:                   supplierInfo.email,
          replyTo:              authUser?.email || '',
          supplierName:         supplierInfo.name,
          vesselName:  vesselName || 'Vessel',
          imoNumber:   vessel?.imo_number || '',
          vesselFlag:  vessel?.flag || '',
          preparedBy,
          signerName:     preparedBy,
          signerJobTitle,
          date:           slipDate,
          supplierPhone:   supplierInfo.phone,
          supplierEmail:   supplierInfo.email,
          supplierAddress: supplierInfo.address,
          orderRef:  orderMeta.ref,
          orderDate: orderMeta.date,
          items: items.map(i => ({
            raw_name:      i.raw_name,
            item_reference: i.item_reference,
            quantity:      i.quantity,
            ordered_qty:   i.ordered_qty,
            return_qty:    i.return_qty,
            return_reason: i.return_reason,
            return_notes:  i.return_notes,
            unit_price:    i.unit_price,
            line_total:    i.line_total,
            unit:          i.unit,
          })),
          vesselSignature: vesselSig,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setSubmitted(true);
    } catch (err) {
      console.error('[ReturnSlip] submit error:', err);
      setSubmitError(err.message || 'Failed to send');
    } finally {
      setSubmitting(false);
    }
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
              {vesselName || 'Vessel'}
              {vessel?.imo_number ? ` · IMO: ${vessel.imo_number}` : ''}
              {vessel?.flag ? ` · ${vessel.flag}` : ''}
            </p>
          </div>
          <div style={{ textAlign: 'right', fontSize: 12, color: '#64748B' }}>
            <p style={{ margin: 0 }}>Date: {slipDate}</p>
            {preparedBy && <p style={{ margin: '4px 0 0' }}>Prepared by: {preparedBy}</p>}
          </div>
        </div>

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

        {/* ── Signature pads ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 60, marginTop: 48, paddingTop: 16, borderTop: '1px solid #E2E8F0' }}>
          <SignaturePad
            label="Vessel authorisation"
            sublabel={[preparedBy, signerJobTitle, slipDate].filter(Boolean).join(' · ')}
            onSign={(dataUrl) => { setVesselSig(dataUrl); setDirty(true); setSaveStatus(null); }}
          />
          <div style={{ flex: 1, maxWidth: 280 }}>
            <div style={{ height: 80, borderBottom: '1px solid #CBD5E1', marginBottom: 8 }} />
            <p style={{ margin: 0, fontSize: 12, color: '#64748B' }}>Supplier acknowledgement</p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94A3B8' }}>Name, signature &amp; date</p>
          </div>
        </div>

        {/* ── Action bar ──────────────────────────────────────────────── */}
        <div className="no-print" style={{ textAlign: 'center', marginTop: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              onClick={saveChanges}
              disabled={saving || (!dirty && saveStatus === 'saved')}
              style={{
                padding: '10px 24px', background: 'white', color: '#1E3A5F',
                border: '1.5px solid #1E3A5F', borderRadius: 8, fontSize: 14, fontWeight: 600,
                cursor: saving || (!dirty && saveStatus === 'saved') ? 'default' : 'pointer',
                opacity: saving || (!dirty && saveStatus === 'saved') ? 0.5 : 1,
                transition: 'opacity 0.2s',
              }}
            >
              {saving ? 'Saving…' : !dirty && saveStatus === 'saved' ? 'Saved ✓' : 'Save Changes'}
            </button>
            <button
              onClick={handleSaveAndPrint}
              disabled={saving}
              style={{
                padding: '10px 28px', background: '#1E3A5F', color: 'white',
                border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
                cursor: saving ? 'default' : 'pointer',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Save & Print'}
            </button>
            <div style={{ width: 1, height: 32, background: '#E2E8F0', margin: '0 4px' }} />
            {supplierInfo.email ? (
              <button
                onClick={handleSubmitToSupplier}
                disabled={submitting || submitted}
                style={{
                  padding: '10px 24px',
                  background: submitted ? '#059669' : '#C65A1A',
                  color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
                  cursor: submitting || submitted ? 'default' : 'pointer',
                  opacity: submitting ? 0.7 : 1,
                  transition: 'background 0.2s',
                  maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
                title={`Send to ${supplierInfo.email}`}
              >
                {submitting ? 'Sending…' : submitted ? 'Sent ✓' : `Email to ${supplierInfo.email}`}
              </button>
            ) : (
              <button disabled style={{
                padding: '10px 24px', background: '#E2E8F0', color: '#94A3B8',
                border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'default',
              }}>
                No supplier email
              </button>
            )}
          </div>
          {/* Status lines */}
          {saveStatus === 'error' && (
            <p style={{ margin: 0, fontSize: 12, color: '#DC2626' }}>
              Some items failed to save. Check your connection and try again.
            </p>
          )}
          {submitError && (
            <p style={{ margin: 0, fontSize: 12, color: '#DC2626' }}>{submitError}</p>
          )}
          {submitted && (
            <p style={{ margin: 0, fontSize: 12, color: '#059669' }}>
              Return slip sent to {supplierInfo.email} — replies will come to your email
            </p>
          )}
          {lastSavedAt && (
            <p style={{ margin: 0, fontSize: 11, color: '#94A3B8' }}>
              Last saved: {lastSavedAt.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {dirty && ' · unsaved changes'}
            </p>
          )}
        </div>

      </div>
    </>
  );
}

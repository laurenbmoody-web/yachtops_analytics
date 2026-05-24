// ─────────────────────────────────────────────────────────────────────────────
// Return Slip page.
//
// Every return — Cargo supplier or not — goes through this page with the
// same fields, reasons, and vessel signature. The only branch is at the
// final Send action, decided silently on load from the supplier's Cargo
// portal-account status:
//   - Cargo supplier  → Send creates a supplier_return_tasks row via the
//                       route_return_to_portal RPC, carrying the signature
//                       and a frozen slip_metadata snapshot. No email.
//   - Non-Cargo       → Send fires the existing sendReturnSlip edge
//                       function exactly as before. Untouched.
// Both paths require the vessel signature before the confirm dialog will
// let Send proceed (unsigned return defeats the audit-trail purpose on
// either channel).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import {
  fetchPortalEnabledSuppliers,
  sendReturnToPortal,
} from './utils/provisioningStorage';
import './delivery-inbox.css';

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
    <circle cx="8" cy="8" r="8" fill="#059669"/>
    <path d="M5 8l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

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

// ─── Editorial form field (label + input/textarea) ──────────────────────────
const Field = ({ label, value, onChange, type = 'text', multiline = false, disabled = false }) => (
  <div className="di-slip-field">
    <label className="di-slip-field-label">{label}</label>
    {multiline ? (
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={2}
        disabled={disabled}
        className="di-slip-textarea"
      />
    ) : (
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="di-slip-input"
      />
    )}
  </div>
);

// ─── Signature pad (functional surface frozen — draw / clear / persist) ─────
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
    ctx.strokeStyle = '#262A53';
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
    <div className="di-slip-sig">
      <div className="di-slip-sig-frame">
        <canvas
          ref={canvasRef}
          width={280}
          height={80}
          className="di-slip-canvas"
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        {!hasStrokes && <span className="di-slip-canvas-placeholder">Sign here</span>}
        {hasStrokes && (
          <button className="no-print di-slip-sig-clear" onClick={clear}>Clear</button>
        )}
      </div>
      <p className="di-slip-sig-label">{label}</p>
      <p className="di-slip-sig-sub">{sublabel}</p>
    </div>
  );
};

export default function ReturnSlipPage() {
  const { user: authUser, activeTenantId, tenantRole } = useAuth();
  const { tenantId: ctxTenantId } = useTenant();
  const tenantId = ctxTenantId || activeTenantId;
  const navigate = useNavigate();

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
  const [supplierConfirmed, setSupplierConfirmed] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  // Decided silently on load; drives which dialog the Send button opens.
  // portalSupplierName carries the canonical supplier_profiles.name for
  // dialog wording.
  const [isPortalEnabled, setIsPortalEnabled] = useState(false);
  const [portalSupplierName, setPortalSupplierName] = useState(null);
  // 'cargo' | 'email' | null. The confirmation dialog is also the gate
  // where the signature requirement is enforced (both paths).
  const [confirmDialog, setConfirmDialog] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const itemIds = (params.get('items') || '').split(',').filter(Boolean);
    if (!itemIds.length) { setLoading(false); return; }

    (async () => {
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

        const confirmedRow = rows.find(r => r.supplier_confirmed_at);
        if (confirmedRow) {
          setSupplierConfirmed({
            at:        new Date(confirmedRow.supplier_confirmed_at),
            name:      confirmedRow.supplier_signer_name || '',
            signature: confirmedRow.supplier_signature   || null,
          });
        }

        const rawDate = first.return_requested_at ? new Date(first.return_requested_at) : new Date();
        setSlipDate(rawDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }));

        const lastGen = rows
          .map(r => r.return_slip_generated_at)
          .filter(Boolean)
          .sort()
          .pop();
        if (lastGen) setLastSavedAt(new Date(lastGen));

        // Silent portal-eligibility lookup. Drives which path Send takes
        // when the crew commit; not surfaced in the UI before they press.
        // Defensive: only resolve when all rows share a single non-null
        // supplier_profile_id (mixed ids → ambiguous → fall through to
        // email flow rather than route to the wrong supplier).
        const supplierIds = new Set(rows.map(r => r.supplier_profile_id).filter(Boolean));
        if (supplierIds.size === 1) {
          const [supplierProfileId] = [...supplierIds];
          const portalMap = await fetchPortalEnabledSuppliers([supplierProfileId]);
          const canonical = portalMap.get(supplierProfileId);
          if (canonical) {
            setIsPortalEnabled(true);
            setPortalSupplierName(canonical);
          }
        }
      }

      const tid = tenantId || rows?.[0]?.tenant_id;
      if (tid) {
        const { data: v } = await supabase
          ?.from('vessels')
          ?.select('name, imo_number, flag')
          ?.eq('tenant_id', tid)
          ?.single();
        setVessel(v);
        if (v?.name) {
          setVesselName(v.name);
        } else {
          const { data: tenant } = await supabase?.from('tenants')?.select('name')?.eq('id', tid)?.single();
          setVesselName(tenant?.name || '');
        }
      }

      if (authUser?.id) {
        const { data: profile } = await supabase
          ?.from('profiles')
          ?.select('full_name, first_name, last_name')
          ?.eq('id', authUser.id)
          ?.single();
        const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.full_name || '';
        setPreparedBy(name);

        if (tid) {
          const { data: member } = await supabase
            ?.from('tenant_members')?.select('role_id')?.eq('user_id', authUser.id)?.eq('tenant_id', tid)?.single();
          if (member?.role_id) {
            const { data: role } = await supabase
              ?.from('roles')?.select('name')?.eq('id', member.role_id)?.single();
            setSignerJobTitle(role?.name || '');
          }
        }
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
    setTimeout(() => window.print(), 200);
  };

  const handleSubmitToSupplier = async () => {
    if (!supplierInfo.email) return;
    await saveChanges();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const token = crypto.randomUUID();
      for (const item of items) {
        await supabase
          ?.from('delivery_inbox')
          ?.update({ return_slip_token: token })
          ?.eq('id', item.id);
      }

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
          confirmationToken: token,
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

  // Cargo path — routes the return into the supplier's portal via the
  // route_return_to_portal RPC. The RPC handles the FOR UPDATE lock,
  // double-submit guard, supplier_return_tasks INSERT (with the slip
  // metadata snapshot below), and the delivery_inbox archive — all in
  // one transaction. No email is sent on this path.
  const handleSendToCargoPortal = async () => {
    if (!items.length) return;
    // Defensive — same uniformity check as the load-time resolution.
    const supplierIds = new Set(items.map(i => i.supplier_profile_id).filter(Boolean));
    if (supplierIds.size !== 1) {
      setSubmitError('Cannot route — supplier ambiguous on this return.');
      return;
    }
    const [supplierProfileId] = [...supplierIds];

    setSubmitting(true);
    setSubmitError(null);
    try {
      await saveChanges();
      const slipMetadata = {
        vessel_name:      vesselName || '',
        vessel_imo:       vessel?.imo_number || null,
        vessel_flag:      vessel?.flag || null,
        signer_name:      preparedBy || '',
        signer_job_title: signerJobTitle || null,
        slip_date:        slipDate || '',
        vessel_signature: vesselSig || null,
      };
      const itemsSnapshot = items.map(i => ({
        raw_name:       i.raw_name,
        item_reference: i.item_reference || null,
        quantity:       i.quantity || null,
        ordered_qty:    i.ordered_qty || null,
        return_qty:     i.return_qty ?? i.quantity ?? null,
        return_reason:  i.return_reason ?? null,
        return_notes:   i.return_notes ?? null,
        unit:           i.unit || null,
        unit_price:     i.unit_price || null,
        line_total:     i.line_total || null,
      }));
      const result = await sendReturnToPortal({
        supplierProfileId,
        tenantId:  tenantId || items[0]?.tenant_id,
        inboxIds:  items.map(i => i.id),
        items:     itemsSnapshot,
        createdBy: authUser?.id || null,
        slipMetadata,
      });
      if (!result.ok) throw new Error('Failed to route return to portal');
      setSubmitted(true);
    } catch (err) {
      console.error('[ReturnSlip] portal route error:', err);
      setSubmitError(err.message || 'Failed to send');
    } finally {
      setSubmitting(false);
    }
  };

  // The single Send button just opens the path-appropriate dialog. The
  // signature gate fires inside the dialog so the crew see exactly why
  // Send is blocked instead of a silently-disabled button.
  const openSendDialog = () => {
    setSubmitError(null);
    setConfirmDialog(isPortalEnabled ? 'cargo' : 'email');
  };
  const closeSendDialog = () => setConfirmDialog(null);
  const confirmSend = async () => {
    setConfirmDialog(null);
    if (isPortalEnabled) {
      await handleSendToCargoPortal();
    } else {
      await handleSubmitToSupplier();
    }
  };

  const isLocked = !!supplierConfirmed;

  const userTier = (tenantRole || '').toUpperCase();
  const canReturnSupplier = userTier === 'COMMAND' || userTier === 'CHIEF';

  // Access-denied screen — reuses the inbox's editorial blocked treatment.
  if (!canReturnSupplier) {
    return (
      <div className="di-blocked">
        <div className="di-blocked-card">
          <p className="di-blocked-title">You don't have permission to view this page.</p>
          <p className="di-blocked-body">Return slips are available to Command and Chief officers only.</p>
          <button onClick={() => navigate('/provisioning/inbox')} className="di-blocked-back">‹ Back to Delivery Inbox</button>
        </div>
      </div>
    );
  }

  const markComplete = async () => {
    const { error } = await supabase
      ?.from('delivery_inbox')
      ?.update({ status: 'archived' })
      ?.in('id', items.map(i => i.id));
    if (!error) navigate('/provisioning/inbox');
  };

  const total = items.reduce((sum, i) => sum + (parseFloat(i.line_total) || 0), 0);
  const showPricing = items.some(i => i.unit_price || i.line_total);
  const showRef     = items.some(i => i.item_reference);
  const showOrdered = items.some(i => i.ordered_qty != null);

  if (loading) {
    return (
      <div className="di-slip">
        <div className="di-slip-page">
          <div className="di-loading">Loading return slip…</div>
        </div>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="di-slip">
        <div className="di-slip-page">
          <div className="di-empty-card">
            <div className="di-empty-tile"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
            <h2 className="di-empty-headline">No items found<span className="di-empty-period">.</span></h2>
            <p className="di-empty-text">Close this tab and re-open the slip from the Returns tab in the Delivery Inbox.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="di-slip">
      <div className="di-slip-page">

        <button className="di-slip-back no-print" onClick={() => navigate('/provisioning/inbox')}>
          ‹ Back to Delivery Inbox
        </button>

        {/* Editorial header — meta strip + serif headline + document meta */}
        <p className="di-slip-meta">
          <span className="di-slip-meta-dot">●</span>
          <span>Delivery Inbox</span>
          <span className="di-slip-meta-bar" />
          <span className="di-slip-meta-muted">Return slip</span>
          {items.length > 0 && <>
            <span className="di-slip-meta-bar" />
            <span className="di-slip-meta-muted">{items.length} item{items.length === 1 ? '' : 's'}</span>
          </>}
        </p>

        <div className="di-slip-header">
          <div>
            <h1 className="di-slip-headline">
              RETURN<span className="di-slip-period">,</span> <em>slip</em><span className="di-slip-period">.</span>
            </h1>
            <p className="di-slip-vessel-line">
              {vesselName || 'Vessel'}
              {vessel?.imo_number ? ` · IMO: ${vessel.imo_number}` : ''}
              {vessel?.flag ? ` · ${vessel.flag}` : ''}
            </p>
          </div>
          <div className="di-slip-doc-meta">
            <p>Date: {slipDate}</p>
            {preparedBy && <p>Prepared by: {preparedBy}</p>}
          </div>
        </div>

        {/* Supplier details — editable form */}
        <div className="di-slip-section">
          <p className="di-slip-section-label">Supplier details</p>
          <div className="di-slip-form-grid">
            <Field label="Company name" value={supplierInfo.name}    onChange={v => setSupplierInfo(p => ({ ...p, name: v }))}    disabled={isLocked} />
            <Field label="Phone"        value={supplierInfo.phone}   onChange={v => setSupplierInfo(p => ({ ...p, phone: v }))}   disabled={isLocked} />
            <Field label="Email"        value={supplierInfo.email}   onChange={v => setSupplierInfo(p => ({ ...p, email: v }))}   disabled={isLocked} />
            <Field label="Address"      value={supplierInfo.address} onChange={v => setSupplierInfo(p => ({ ...p, address: v }))} disabled={isLocked} />
          </div>
        </div>

        {/* Order reference */}
        {(orderMeta.ref || orderMeta.date || orderMeta.noteRef || orderMeta.noteUrl) && (
          <div className="di-slip-order-row">
            {orderMeta.ref     && <span><strong>Order ref:</strong> {orderMeta.ref}</span>}
            {orderMeta.date    && <span><strong>Order date:</strong> {orderMeta.date}</span>}
            {orderMeta.noteRef && <span><strong>Delivery note ref:</strong> {orderMeta.noteRef}</span>}
            {orderMeta.noteUrl && (
              <a href={orderMeta.noteUrl} target="_blank" rel="noreferrer" className="di-slip-order-link">
                View original delivery note ↗
              </a>
            )}
          </div>
        )}

        {/* Items table */}
        <div className="di-slip-table-wrap">
          <table className="di-slip-table">
            <thead>
              <tr>
                {showRef     && <th>Ref</th>}
                <th>Description</th>
                {showOrdered && <th className="di-slip-td-center" style={{ width: 70 }}>Ordered</th>}
                <th className="di-slip-td-center" style={{ width: 80 }}>Delivered</th>
                <th className="di-slip-td-center" style={{ width: 96 }}>Return qty</th>
                {showPricing && <th className="di-slip-td-right" style={{ width: 96 }}>Unit price</th>}
                {showPricing && <th className="di-slip-td-right" style={{ width: 96 }}>Total</th>}
                <th style={{ width: 156 }}>Reason</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id}>
                  {showRef && (
                    <td className="di-slip-td-ref">{item.item_reference || '—'}</td>
                  )}
                  <td>{item.raw_name}</td>
                  {showOrdered && (
                    <td className="di-slip-td-center di-slip-td-muted">{item.ordered_qty ?? '—'}</td>
                  )}
                  <td className="di-slip-td-center">{item.quantity ?? '—'}{item.unit ? ` ${item.unit}` : ''}</td>
                  <td className="di-slip-td-center">
                    <input
                      className="di-slip-table-input di-slip-table-qty print-val"
                      type="number"
                      value={item.return_qty}
                      onChange={e => updateItem(item.id, 'return_qty', Math.max(1, Math.min(item.quantity, parseInt(e.target.value) || 1)))}
                      min={1}
                      max={item.quantity}
                      disabled={isLocked}
                    />
                  </td>
                  {showPricing && <td className="di-slip-td-right di-slip-td-muted">{fmtCurrency(item.unit_price)}</td>}
                  {showPricing && <td className="di-slip-td-right" style={{ fontWeight: 600 }}>{fmtCurrency(item.line_total)}</td>}
                  <td>
                    <select
                      className="di-slip-table-select print-val"
                      value={item.return_reason}
                      onChange={e => updateItem(item.id, 'return_reason', e.target.value)}
                      disabled={isLocked}
                    >
                      {REASON_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td>
                    <input
                      className="di-slip-table-input print-val"
                      type="text"
                      value={item.return_notes}
                      onChange={e => updateItem(item.id, 'return_notes', e.target.value)}
                      placeholder="Optional…"
                      disabled={isLocked}
                    />
                  </td>
                </tr>
              ))}
              {showPricing && total > 0 && (
                <tr className="di-slip-total-row">
                  <td
                    colSpan={(showRef ? 1 : 0) + 1 + (showOrdered ? 1 : 0) + 1 + 1 + 1}
                    className="di-slip-td-right"
                  >
                    Total
                  </td>
                  <td className="di-slip-td-right" style={{ fontWeight: 700 }}>{fmtCurrency(total)}</td>
                  <td colSpan={2} />
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Signature row */}
        <div className="di-slip-sig-row">
          {isLocked ? (
            <div className="di-slip-sig">
              {vesselSig ? (
                <img src={vesselSig} alt="Vessel signature" className="di-slip-sig-img" />
              ) : (
                <div className="di-slip-sig-empty" />
              )}
              <p className="di-slip-sig-label">Vessel authorisation</p>
              <p className="di-slip-sig-sub">
                {[preparedBy, signerJobTitle, slipDate].filter(Boolean).join(' · ')}
              </p>
            </div>
          ) : (
            <SignaturePad
              label="Vessel authorisation"
              sublabel={[preparedBy, signerJobTitle, slipDate].filter(Boolean).join(' · ')}
              onSign={(dataUrl) => { setVesselSig(dataUrl); setDirty(true); setSaveStatus(null); }}
            />
          )}
          <div className="di-slip-sig">
            {supplierConfirmed?.signature ? (
              <>
                <img src={supplierConfirmed.signature} alt="Supplier signature" className="di-slip-sig-img" />
                <p className="di-slip-sig-label">Supplier acknowledgement</p>
                <p className="di-slip-sig-sub">
                  {[supplierConfirmed.name, supplierConfirmed.at.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })].filter(Boolean).join(' · ')}
                </p>
              </>
            ) : (
              <>
                <div className="di-slip-sig-empty" />
                <p className="di-slip-sig-label">Supplier acknowledgement</p>
                <p className="di-slip-sig-sub" style={{ fontStyle: 'normal', color: 'var(--di-faint)' }}>Name, signature &amp; date</p>
              </>
            )}
          </div>
        </div>

        {/* Action bar */}
        {isLocked ? (
          <div className="no-print di-slip-actions">
            <div className="di-slip-locked-banner">
              <CheckIcon />
              <span>
                This return has been confirmed by <strong>{supplierConfirmed.name}</strong> on{' '}
                {supplierConfirmed.at.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.
                The slip is now read-only.
              </span>
            </div>
            <div className="di-slip-actions-row">
              <button onClick={() => window.print()} className="di-btn di-btn-primary">Print</button>
              <button onClick={markComplete} className="di-btn di-btn-ghost">Mark as complete &amp; archive</button>
            </div>
          </div>
        ) : (
          <div className="no-print di-slip-actions">
            <div className="di-slip-actions-row">
              <button
                onClick={saveChanges}
                disabled={saving || (!dirty && saveStatus === 'saved')}
                className="di-btn di-btn-ghost"
              >
                {saving ? 'Saving…' : !dirty && saveStatus === 'saved' ? 'Saved ✓' : 'Save changes'}
              </button>
              <button
                onClick={handleSaveAndPrint}
                disabled={saving}
                className="di-btn di-btn-primary"
              >
                {saving ? 'Saving…' : 'Save & print'}
              </button>
              <div className="di-slip-actions-sep" />
              {(isPortalEnabled || supplierInfo.email) ? (
                <button
                  onClick={openSendDialog}
                  disabled={submitting || submitted}
                  className="di-btn di-btn-rust"
                  title={isPortalEnabled
                    ? `Send to ${portalSupplierName || supplierInfo.name || 'supplier'}'s Cargo portal`
                    : `Email to ${supplierInfo.email}`}
                >
                  {submitting ? 'Sending…' : submitted ? 'Sent ✓' : 'Send return'}
                </button>
              ) : (
                <button disabled className="di-btn-disabled-static">No supplier email</button>
              )}
            </div>
            {saveStatus === 'error' && (
              <p className="di-slip-status-line is-error">
                Some items failed to save. Check your connection and try again.
              </p>
            )}
            {submitError && (
              <p className="di-slip-status-line is-error">{submitError}</p>
            )}
            {submitted && (
              <p className="di-slip-status-line is-success">
                {isPortalEnabled
                  ? `Return routed to ${portalSupplierName || supplierInfo.name || 'supplier'}'s Cargo portal.`
                  : `Return slip sent to ${supplierInfo.email} — replies will come to your email.`}
              </p>
            )}
            {lastSavedAt && (
              <p className="di-slip-status-line">
                Last saved: {lastSavedAt.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                {dirty && ' · unsaved changes'}
              </p>
            )}
          </div>
        )}

        {/* Confirmation dialog — opens on Send. Path-specific wording.
            The vessel-signature requirement is enforced here (not on
            the button) so the crew see exactly why Send is blocked
            instead of a silently-disabled button. Same rule on both
            paths: unsigned return defeats the audit-trail purpose
            whether it goes by portal or email. */}
        {confirmDialog && (
          <div className="no-print di-slip-confirm-backdrop" onClick={closeSendDialog}>
            <div
              className="di-slip-confirm-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="di-slip-confirm-title"
              onClick={e => e.stopPropagation()}
            >
              {!vesselSig ? (
                <>
                  <p id="di-slip-confirm-title" className="di-slip-confirm-title">
                    Sign the return before sending
                  </p>
                  <p className="di-slip-confirm-body">
                    The return needs your signature on the slip — use the Vessel
                    authorisation pad above. The supplier sees a signed,
                    authorised return on both paths; unsigned returns aren&rsquo;t
                    sent.
                  </p>
                  <div className="di-slip-confirm-actions">
                    <button className="di-btn di-btn-ghost" onClick={closeSendDialog}>
                      Close
                    </button>
                  </div>
                </>
              ) : confirmDialog === 'cargo' ? (
                <>
                  <p id="di-slip-confirm-title" className="di-slip-confirm-title">
                    Send return to {portalSupplierName || supplierInfo.name || 'supplier'} via their Cargo portal?
                  </p>
                  <p className="di-slip-confirm-body">
                    The return — items, reasons, and your signature — will land
                    as a task in their Cargo portal. No email goes out.
                  </p>
                  <div className="di-slip-confirm-actions">
                    <button className="di-btn di-btn-ghost" onClick={closeSendDialog}>
                      Cancel
                    </button>
                    <button className="di-btn di-btn-rust" onClick={confirmSend}>
                      Send to portal
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p id="di-slip-confirm-title" className="di-slip-confirm-title">
                    Email return slip to {supplierInfo.email}?
                  </p>
                  <p className="di-slip-confirm-body">
                    The signed slip is sent to the supplier. Replies will come
                    to your email.
                  </p>
                  <div className="di-slip-confirm-actions">
                    <button className="di-btn di-btn-ghost" onClick={closeSendDialog}>
                      Cancel
                    </button>
                    <button className="di-btn di-btn-rust" onClick={confirmSend}>
                      Send email
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabaseClient';
import SignaturePad from '../../../components/SignaturePad';

// /delivery-sign/:token — public capability URL embedded as a QR code in
// the unsigned delivery note PDF. Receiving crew on a phone scans it,
// confirms the delivery, types their name, signs on the canvas, and
// optionally records discrepancies. Submit calls the signDeliveryNote
// edge function (Sprint 9b Commit 6) which writes back to supplier_orders
// and re-renders the signed PDF.
//
// Read access goes through fetch_order_for_delivery_signing(token) — a
// SECURITY DEFINER RPC that returns a single JSON envelope or NULL.
// Possession of the token IS the authorisation.

const CheckIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, display: 'block' }}>
    <circle cx="8" cy="8" r="8" fill="#059669"/>
    <path d="M5 8l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const Page = ({ children }) => (
  <>
    <style>{`
      * { box-sizing: border-box; }
      body { margin: 0; background: #FDF8F4; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.12); opacity: 0.85; } }
    `}</style>
    <div style={{
      minHeight: '100vh', background: '#FDF8F4',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#0F172A', padding: '32px 16px 64px',
    }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: '#1E3A5F', letterSpacing: '-0.5px' }}>cargo</span>
        <span style={{ fontSize: 22, color: '#CBD5E1', margin: '0 10px', fontWeight: 300 }}>|</span>
        <span style={{ fontSize: 13, color: '#94A3B8', fontWeight: 500 }}>Delivery sign-off</span>
      </div>

      <div style={{
        maxWidth: 640, margin: '0 auto',
        background: 'white', borderRadius: 12,
        boxShadow: '0 1px 4px rgba(0,0,0,0.06), 0 4px 24px rgba(0,0,0,0.04)',
        overflow: 'hidden',
      }}>
        {children}
      </div>

      <p style={{ textAlign: 'center', marginTop: 32, fontSize: 11, color: '#CBD5E1' }}>
        Powered by{' '}
        <a href="https://cargotechnology.app" target="_blank" rel="noreferrer"
          style={{ color: '#94A3B8', textDecoration: 'none' }}>
          Cargo (cargotechnology.app)
        </a>
      </p>
    </div>
  </>
);

const CardHeader = ({ vesselName, orderRef, supplierName }) => (
  <div style={{ background: '#1E3A5F', padding: '22px 28px' }}>
    <h1 style={{ margin: '0 0 5px', fontSize: 19, fontWeight: 700, color: '#FFFFFF', letterSpacing: '-0.3px' }}>
      Confirm Delivery
    </h1>
    <p style={{ margin: 0, fontSize: 12, color: '#93C5FD' }}>
      {[vesselName, orderRef ? `Order: ${orderRef}` : null, supplierName].filter(Boolean).join(' · ')}
    </p>
  </div>
);

// Delivery summary block — the four key facts so the signer knows they're
// confirming the right delivery before they sign.
const DeliveryFacts = ({ order }) => {
  const fmtDate = (iso) => {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return iso; }
  };
  const fmtTime = (t) => (t ? String(t).slice(0, 5) : null);

  const cells = [
    { label: 'Date',    value: fmtDate(order.delivery_date) },
    { label: 'Time',    value: fmtTime(order.delivery_time) || '—' },
    { label: 'Port',    value: order.delivery_port || '—' },
    { label: 'Contact', value: order.delivery_contact || '—' },
  ];

  return (
    <div style={{
      padding: '16px 24px 0',
    }}>
      <div style={{
        background: '#F8FAFC', border: '1px solid #E2E8F0',
        borderRadius: 10, padding: '14px 16px',
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10,
      }}>
        {cells.map((c) => (
          <div key={c.label}>
            <div style={{
              fontSize: 9.5, color: '#94A3B8',
              letterSpacing: '0.1em', textTransform: 'uppercase',
              fontWeight: 600, marginBottom: 1,
            }}>{c.label}</div>
            <div style={{ fontSize: 13, color: '#0F172A', fontWeight: 600 }}>{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const ItemsTable = ({ items }) => {
  const th = { textAlign: 'left', padding: '8px 12px', fontWeight: 600, fontSize: 11, color: '#475569', background: '#F8FAFC', borderBottom: '2px solid #E2E8F0' };
  const td = { padding: '9px 12px', fontSize: 13, borderBottom: '1px solid #F1F5F9', verticalAlign: 'middle' };

  // Skip lines explicitly marked unavailable — they aren't part of the
  // physical delivery, and showing them would confuse the receiving crew.
  const visible = items.filter((it) =>
    it.status !== 'unavailable' && it.quote_status !== 'unavailable'
  );

  return (
    <div style={{ padding: '20px 24px 4px' }}>
      <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Items being delivered
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Item</th>
            <th style={{ ...th, textAlign: 'center', width: 80 }}>Qty</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 && (
            <tr>
              <td colSpan={2} style={{ ...td, textAlign: 'center', color: '#94A3B8', fontStyle: 'italic' }}>
                No items.
              </td>
            </tr>
          )}
          {visible.map((it) => (
            <tr key={it.id}>
              <td style={td}>
                <div>{it.item_name}</div>
                {it.substitute_description && (
                  <div style={{ marginTop: 2, fontSize: 11, color: '#92400E' }}>
                    <strong>Substituted:</strong> {it.substitute_description}
                  </div>
                )}
                {it.notes && (
                  <div style={{ marginTop: 2, fontSize: 11, color: '#64748B' }}>{it.notes}</div>
                )}
              </td>
              <td style={{ ...td, textAlign: 'center' }}>
                {it.quantity ?? '—'}{it.unit ? ` ${it.unit}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const inputStyle = (focused = false) => ({
  width: '100%',
  border: `1px solid ${focused ? '#1E3A5F' : '#E2E8F0'}`,
  borderRadius: 8, padding: '10px 12px',
  fontSize: 14, color: '#0F172A',
  fontFamily: 'inherit', outline: 'none',
  transition: 'border-color 0.15s',
});

export default function DeliverySigningPage() {
  const { token } = useParams();
  const [status, setStatus] = useState('loading');           // loading | not_found | already_signed | ready | submitted
  const [data, setData] = useState(null);                    // { order, supplier, items }
  const [signerName, setSignerName] = useState('');
  const [signature, setSignature] = useState(null);
  const [discrepancyNotes, setDiscrepancyNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [validationErr, setValidationErr] = useState('');

  useEffect(() => {
    if (!token) { setStatus('not_found'); return; }
    (async () => {
      try {
        const { data: rpcData, error } = await supabase
          .rpc('fetch_order_for_delivery_signing', { p_token: token });
        if (error) throw error;
        if (!rpcData) { setStatus('not_found'); return; }
        setData(rpcData);
        setStatus(rpcData.order?.crew_signed_at ? 'already_signed' : 'ready');
      } catch (err) {
        console.error('[DeliverySign] fetch error:', err);
        setStatus('not_found');
      }
    })();
  }, [token]);

  const handleSubmit = async () => {
    setValidationErr('');
    if (!signerName.trim()) { setValidationErr('Please enter your name.'); return; }
    if (!signature)         { setValidationErr('Please draw your signature.'); return; }
    setSubmitting(true);
    try {
      // The signDeliveryNote edge function (Sprint 9b Commit 6) writes the
      // signature back, regenerates the signed PDF, and advances the
      // order status. Until Commit 6 deploys this will return a function-
      // not-found error — the page's submit button is the entire trigger.
      const { data: res, error } = await supabase.functions.invoke('signDeliveryNote', {
        body: {
          token,
          signer_name: signerName.trim(),
          signature_data_url: signature,
          discrepancy_notes: discrepancyNotes.trim() || null,
        },
      });
      if (error) throw error;
      if (res?.error) throw new Error(res.error);
      setStatus('submitted');
    } catch (err) {
      console.error('[DeliverySign] submit error:', err);
      setValidationErr(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (status === 'loading') return (
    <Page>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
        <div style={{ textAlign: 'center', color: '#94A3B8' }}>
          <div style={{ width: 32, height: 32, border: '3px solid #E2E8F0', borderTopColor: '#1E3A5F', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
          <p style={{ margin: 0, fontSize: 14 }}>Loading…</p>
        </div>
      </div>
    </Page>
  );

  // ── Not found / invalid token ──────────────────────────────────────────────
  if (status === 'not_found') return (
    <Page>
      <div style={{ textAlign: 'center', padding: '64px 24px' }}>
        <div style={{ fontSize: 44, marginBottom: 16 }}>⚠️</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 20, color: '#1E3A5F' }}>Link not found</h2>
        <p style={{ margin: 0, color: '#64748B', fontSize: 14, lineHeight: 1.6 }}>
          This delivery sign-off link is invalid or has expired. Ask the supplier to send a fresh delivery note.
        </p>
      </div>
    </Page>
  );

  const order = data?.order || {};
  const supplier = data?.supplier || {};
  const items = data?.items || [];
  const orderRef = order.id ? `#${String(order.id).slice(0, 8).toUpperCase()}` : '';

  // ── Already signed ─────────────────────────────────────────────────────────
  if (status === 'already_signed') return (
    <Page>
      <CardHeader vesselName={order.vessel_name} orderRef={orderRef} supplierName={supplier.name} />
      <div style={{ padding: '24px 24px 0' }}>
        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, padding: '20px 24px', textAlign: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><CheckIcon size={40} /></div>
          <p style={{ margin: 0, fontSize: 14, color: '#047857', lineHeight: 1.6 }}>
            This delivery has already been signed by{' '}
            <strong>{order.crew_signer_name || 'the crew'}</strong>
            {order.crew_signed_at ? <> on {new Date(order.crew_signed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</> : null}.
          </p>
        </div>
      </div>
      <ItemsTable items={items} />
      <div style={{ height: 24 }} />
    </Page>
  );

  // ── Submitted (success) ────────────────────────────────────────────────────
  if (status === 'submitted') return (
    <Page>
      <CardHeader vesselName={order.vessel_name} orderRef={orderRef} supplierName={supplier.name} />
      <div style={{ padding: '48px 24px 40px', textAlign: 'center' }}>
        <div style={{ animation: 'pulse 1.8s ease-in-out 3', display: 'flex', justifyContent: 'center', marginBottom: 20 }}><CheckIcon size={56} /></div>
        <h2 style={{ margin: '0 0 10px', fontSize: 22, fontWeight: 700, color: '#065F46' }}>Delivery confirmed</h2>
        <p style={{ margin: 0, fontSize: 15, color: '#047857', lineHeight: 1.6, maxWidth: 400, marginLeft: 'auto', marginRight: 'auto' }}>
          Thanks — the signed delivery note has been sent to {supplier.name || 'the supplier'}. You can close this page.
        </p>
      </div>
    </Page>
  );

  // ── Ready (main form) ──────────────────────────────────────────────────────
  return (
    <Page>
      <CardHeader vesselName={order.vessel_name} orderRef={orderRef} supplierName={supplier.name} />

      <DeliveryFacts order={order} />
      <ItemsTable items={items} />

      <div style={{ padding: '8px 24px 28px' }}>
        <div style={{ border: '1px solid #E2E8F0', borderRadius: 10, padding: '20px 20px 22px', marginBottom: 20 }}>
          <p style={{ margin: '0 0 16px', fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Confirm receipt
          </p>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#64748B', marginBottom: 6 }}>
              Your name <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <input
              type="text"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Full name"
              style={inputStyle()}
              onFocus={(e) => { e.target.style.borderColor = '#1E3A5F'; }}
              onBlur={(e) => { e.target.style.borderColor = '#E2E8F0'; }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#64748B', marginBottom: 6 }}>
              Signature <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <SignaturePad onSign={setSignature} />
            <p style={{ margin: '6px 0 0', fontSize: 11, color: '#94A3B8' }}>Draw your signature above</p>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#64748B', marginBottom: 6 }}>
              Discrepancies <span style={{ color: '#94A3B8', fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea
              value={discrepancyNotes}
              onChange={(e) => setDiscrepancyNotes(e.target.value)}
              placeholder="e.g. 1× milk short. Tomatoes bruised. Substitution accepted."
              rows={3}
              style={{ ...inputStyle(), resize: 'vertical', minHeight: 64, fontFamily: 'inherit' }}
              onFocus={(e) => { e.target.style.borderColor = '#1E3A5F'; }}
              onBlur={(e) => { e.target.style.borderColor = '#E2E8F0'; }}
            />
            <p style={{ margin: '6px 0 0', fontSize: 11, color: '#94A3B8' }}>
              Anything missing, damaged, or substituted? Note it here — the supplier and your provisioning lead will see it.
            </p>
          </div>

          {validationErr && (
            <p style={{ margin: '14px 0 0', fontSize: 13, color: '#DC2626', fontWeight: 500 }}>{validationErr}</p>
          )}
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          style={{
            width: '100%', height: 48,
            background: submitting ? '#6EE7B7' : '#059669',
            color: '#FFFFFF', border: 'none', borderRadius: 10,
            fontSize: 15, fontWeight: 700,
            cursor: submitting ? 'default' : 'pointer',
            transition: 'background 0.2s, transform 0.1s',
            letterSpacing: '0.01em',
          }}
          onMouseEnter={(e) => { if (!submitting) e.currentTarget.style.background = '#047857'; }}
          onMouseLeave={(e) => { if (!submitting) e.currentTarget.style.background = '#059669'; }}
        >
          {submitting ? 'Confirming…' : 'Confirm delivery'}
        </button>
      </div>
    </Page>
  );
}

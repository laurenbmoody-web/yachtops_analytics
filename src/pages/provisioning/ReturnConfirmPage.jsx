import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';

// ── Signature pad ─────────────────────────────────────────────────────────────

const SignaturePad = ({ onSign }) => {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const touch = e.touches?.[0];
    return {
      x: (touch ? touch.clientX : e.clientX) - rect.left,
      y: (touch ? touch.clientY : e.clientY) - rect.top,
    };
  };

  const startDraw = useCallback((e) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.beginPath(); ctx.moveTo(x, y);
    setDrawing(true);
  }, []);

  const draw = useCallback((e) => {
    if (!drawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#1E3A5F'; ctx.lineWidth = 2;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke();
    setHasStrokes(true);
  }, [drawing]);

  const endDraw = useCallback(() => {
    setDrawing(false);
    if (hasStrokes && canvasRef.current) onSign?.(canvasRef.current.toDataURL('image/png'));
  }, [hasStrokes, onSign]);

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    setHasStrokes(false);
    onSign?.(null);
  };

  return (
    <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid #E2E8F0', background: '#FAFAFA' }}>
      <canvas
        ref={canvasRef}
        width={560}
        height={110}
        style={{ width: '100%', height: 110, cursor: 'crosshair', touchAction: 'none', display: 'block' }}
        onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
        onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
      />
      {!hasStrokes && (
        <span style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          fontSize: 13, color: '#CBD5E1', pointerEvents: 'none', userSelect: 'none',
        }}>Sign here</span>
      )}
      {hasStrokes && (
        <button onClick={clear} style={{
          position: 'absolute', top: 8, right: 10, background: 'none', border: 'none',
          fontSize: 11, color: '#94A3B8', cursor: 'pointer', padding: '2px 6px',
        }}
          onMouseEnter={e => { e.currentTarget.style.color = '#DC2626'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#94A3B8'; }}>
          Clear
        </button>
      )}
      <div style={{ borderTop: '1px solid #E2E8F0', height: 0, position: 'absolute', bottom: 28, left: 16, right: 16 }} />
    </div>
  );
};

// ── Page wrapper (off-white background, full height) ──────────────────────────

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
      {/* Cargo wordmark */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: '#1E3A5F', letterSpacing: '-0.5px' }}>cargo</span>
        <span style={{ fontSize: 22, color: '#CBD5E1', margin: '0 10px', fontWeight: 300 }}>|</span>
        <span style={{ fontSize: 13, color: '#94A3B8', fontWeight: 500 }}>Returns</span>
      </div>

      {/* Card */}
      <div style={{
        maxWidth: 640, margin: '0 auto',
        background: 'white', borderRadius: 12,
        boxShadow: '0 1px 4px rgba(0,0,0,0.06), 0 4px 24px rgba(0,0,0,0.04)',
        overflow: 'hidden',
      }}>
        {children}
      </div>

      {/* Footer */}
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

// ── Navy card header ───────────────────────────────────────────────────────────

const CardHeader = ({ vesselName, orderRef, supplierName }) => (
  <div style={{ background: '#1E3A5F', padding: '22px 28px' }}>
    <h1 style={{ margin: '0 0 5px', fontSize: 19, fontWeight: 700, color: '#FFFFFF', letterSpacing: '-0.3px' }}>
      Return Slip Confirmation
    </h1>
    <p style={{ margin: 0, fontSize: 12, color: '#93C5FD' }}>
      {[vesselName, orderRef ? `Order: ${orderRef}` : null, supplierName].filter(Boolean).join(' · ')}
    </p>
  </div>
);

// ── Items table ───────────────────────────────────────────────────────────────

const ItemsTable = ({ items }) => {
  const showOrdered = items.some(i => i.ordered_qty != null);
  const th = { textAlign: 'left', padding: '8px 12px', fontWeight: 600, fontSize: 11, color: '#475569', background: '#F8FAFC', borderBottom: '2px solid #E2E8F0' };
  const td = { padding: '9px 12px', fontSize: 13, borderBottom: '1px solid #F1F5F9', verticalAlign: 'middle' };
  return (
    <div style={{ padding: '20px 24px 4px' }}>
      <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Items for Return
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Description</th>
            {showOrdered && <th style={{ ...th, textAlign: 'center', width: 72 }}>Ordered</th>}
            <th style={{ ...th, textAlign: 'center', width: 80 }}>Delivered</th>
            <th style={{ ...th, textAlign: 'center', width: 80 }}>Return Qty</th>
            <th style={{ ...th, width: 130 }}>Reason</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id}>
              <td style={td}>{item.raw_name}</td>
              {showOrdered && <td style={{ ...td, textAlign: 'center', color: '#64748B' }}>{item.ordered_qty ?? '—'}</td>}
              <td style={{ ...td, textAlign: 'center' }}>{item.quantity ?? '—'}{item.unit ? ` ${item.unit}` : ''}</td>
              <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>{item.return_qty ?? item.quantity}</td>
              <td style={{ ...td, color: '#475569', fontSize: 12 }}>{item.return_reason || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ReturnConfirmPage() {
  const [status, setStatus]             = useState('loading');
  const [items, setItems]               = useState([]);
  const [vesselName, setVesselName]     = useState('');
  const [orderRef, setOrderRef]         = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [confirmedAt, setConfirmedAt]   = useState(null);
  const [confirmedBy, setConfirmedBy]   = useState('');
  const [signerName, setSignerName]     = useState('');
  const [signature, setSignature]       = useState(null);
  const [submitting, setSubmitting]     = useState(false);
  const [validationErr, setValidationErr] = useState('');

  const token = new URLSearchParams(window.location.search).get('token');

  useEffect(() => {
    if (!token) { setStatus('not_found'); return; }
    (async () => {
      const { data: rows, error } = await supabase
        .from('delivery_inbox').select('*').eq('return_slip_token', token);
      if (error || !rows?.length) { setStatus('not_found'); return; }
      const first = rows[0];
      setItems(rows);
      setSupplierName(first.supplier_name || '');
      setOrderRef(first.order_ref || '');
      if (first.tenant_id) {
        const { data: tenant } = await supabase
          .from('tenants').select('name').eq('id', first.tenant_id).single();
        setVesselName(tenant?.name || '');
      }
      if (first.supplier_confirmed_at) {
        setConfirmedAt(new Date(first.supplier_confirmed_at));
        setConfirmedBy(first.supplier_signer_name || '');
        setStatus('already_confirmed');
      } else {
        setStatus('ready');
      }
    })();
  }, [token]);

  const handleConfirm = async () => {
    setValidationErr('');
    if (!signerName.trim()) { setValidationErr('Please enter your name.'); return; }
    if (!signature)         { setValidationErr('Please draw your signature.'); return; }
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase.from('delivery_inbox').update({
        supplier_confirmed_at: now,
        supplier_signature:    signature,
        supplier_signer_name:  signerName.trim(),
      }).eq('return_slip_token', token);
      if (error) throw error;
      // Notify crew member (best-effort)
      const crewUserId = items[0]?.return_slip_generated_by;
      if (crewUserId) {
        await supabase.from('notifications').insert({
          user_id:    crewUserId,
          type:       'RETURN_CONFIRMED',
          title:      'Return confirmed by supplier',
          message:    `${signerName.trim()} from ${items[0]?.supplier_name || 'the supplier'} has confirmed receipt of ${items.length} returned item${items.length !== 1 ? 's' : ''}`,
          severity:   'INFO',
          action_url: '/provisioning/inbox',
          read:       false,
          created_at: now,
        }).then(() => {}).catch(() => {});
      }
      setStatus('confirmed');
    } catch (err) {
      console.error('[ReturnConfirm] confirm error:', err);
      setValidationErr('Something went wrong. Please try again.');
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

  // ── Not found ──────────────────────────────────────────────────────────────
  if (status === 'not_found') return (
    <Page>
      <div style={{ textAlign: 'center', padding: '64px 24px' }}>
        <div style={{ fontSize: 44, marginBottom: 16 }}>⚠️</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 20, color: '#1E3A5F' }}>Link not found</h2>
        <p style={{ margin: 0, color: '#64748B', fontSize: 14, lineHeight: 1.6 }}>
          This confirmation link is invalid or has expired.
        </p>
      </div>
    </Page>
  );

  // ── Already confirmed ──────────────────────────────────────────────────────
  if (status === 'already_confirmed') return (
    <Page>
      <CardHeader vesselName={vesselName} orderRef={orderRef} supplierName={supplierName} />
      <div style={{ padding: '24px 24px 0' }}>
        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, padding: '20px 24px', textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
          <p style={{ margin: 0, fontSize: 14, color: '#047857', lineHeight: 1.6 }}>
            This return has already been confirmed by{' '}
            <strong>{confirmedBy}</strong> on{' '}
            {confirmedAt?.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>
      <ItemsTable items={items} />
      <div style={{ height: 24 }} />
    </Page>
  );

  // ── Confirmed (success) ────────────────────────────────────────────────────
  if (status === 'confirmed') return (
    <Page>
      <CardHeader vesselName={vesselName} orderRef={orderRef} supplierName={supplierName} />
      <div style={{ padding: '48px 24px 40px', textAlign: 'center' }}>
        <div style={{ animation: 'pulse 1.8s ease-in-out 3', fontSize: 56, lineHeight: 1, marginBottom: 20 }}>✅</div>
        <h2 style={{ margin: '0 0 10px', fontSize: 22, fontWeight: 700, color: '#065F46' }}>Receipt confirmed</h2>
        <p style={{ margin: 0, fontSize: 15, color: '#047857', lineHeight: 1.6, maxWidth: 400, marginLeft: 'auto', marginRight: 'auto' }}>
          Your confirmation has been sent to {vesselName || 'the vessel'}. You can close this page.
        </p>
      </div>
    </Page>
  );

  // ── Ready (main form) ──────────────────────────────────────────────────────
  return (
    <Page>
      <CardHeader vesselName={vesselName} orderRef={orderRef} supplierName={supplierName} />

      <ItemsTable items={items} />

      {/* Confirmation form */}
      <div style={{ padding: '20px 24px 28px' }}>
        <div style={{ border: '1px solid #E2E8F0', borderRadius: 10, padding: '20px 20px 22px', marginBottom: 20 }}>
          <p style={{ margin: '0 0 16px', fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Supplier Confirmation
          </p>

          {/* Name input */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#64748B', marginBottom: 6 }}>
              Your name <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <input
              type="text"
              value={signerName}
              onChange={e => setSignerName(e.target.value)}
              placeholder="Full name"
              style={{
                width: '100%', border: '1px solid #E2E8F0', borderRadius: 8,
                padding: '10px 12px', fontSize: 14, color: '#0F172A',
                fontFamily: 'inherit', outline: 'none',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => { e.target.style.borderColor = '#1E3A5F'; }}
              onBlur={e => { e.target.style.borderColor = '#E2E8F0'; }}
            />
          </div>

          {/* Signature pad */}
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#64748B', marginBottom: 6 }}>
              Signature <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <SignaturePad onSign={setSignature} />
            <p style={{ margin: '6px 0 0', fontSize: 11, color: '#94A3B8' }}>Draw your signature above</p>
          </div>

          {validationErr && (
            <p style={{ margin: '14px 0 0', fontSize: 13, color: '#DC2626', fontWeight: 500 }}>{validationErr}</p>
          )}
        </div>

        <button
          onClick={handleConfirm}
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
          onMouseEnter={e => { if (!submitting) e.currentTarget.style.background = '#047857'; }}
          onMouseLeave={e => { if (!submitting) e.currentTarget.style.background = '#059669'; }}
        >
          {submitting ? 'Confirming…' : 'Confirm Receipt'}
        </button>
      </div>
    </Page>
  );
}

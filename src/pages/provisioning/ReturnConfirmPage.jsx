import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';

// ── Signature pad (copied from ReturnSlipPage — this is a self-contained public page) ──

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
    <div style={{ width: '100%' }}>
      <div style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          width={540}
          height={100}
          style={{
            width: '100%', height: 100,
            borderBottom: '2px solid #CBD5E1',
            cursor: 'crosshair', touchAction: 'none',
            background: '#FAFAFA',
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
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: 13, color: '#CBD5E1', pointerEvents: 'none', userSelect: 'none',
          }}>
            Sign here
          </span>
        )}
        {hasStrokes && (
          <button
            onClick={clear}
            style={{
              position: 'absolute', top: 6, right: 8, background: 'none', border: 'none',
              fontSize: 11, color: '#94A3B8', cursor: 'pointer', padding: '2px 6px',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#DC2626'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#94A3B8'; }}
          >
            Clear
          </button>
        )}
      </div>
      {label    && <p style={{ margin: '8px 0 0', fontSize: 13, color: '#64748B' }}>{label}</p>}
      {sublabel && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94A3B8' }}>{sublabel}</p>}
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ReturnConfirmPage() {
  const [status, setStatus]             = useState('loading'); // loading | not_found | already_confirmed | ready | confirmed
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
        .from('delivery_inbox')
        .select('*')
        .eq('return_slip_token', token);

      if (error || !rows?.length) { setStatus('not_found'); return; }

      const first = rows[0];
      setItems(rows);
      setSupplierName(first.supplier_name || '');
      setOrderRef(first.order_ref || '');

      // Fetch vessel/tenant name
      if (first.tenant_id) {
        const { data: tenant } = await supabase
          .from('tenants')
          .select('name')
          .eq('id', first.tenant_id)
          .single();
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

      const { error } = await supabase
        .from('delivery_inbox')
        .update({
          supplier_confirmed_at: now,
          supplier_signature:    signature,
          supplier_signer_name:  signerName.trim(),
        })
        .eq('return_slip_token', token);

      if (error) throw error;

      // Notify the crew member who generated the slip
      // (best-effort — fails silently if notifications table doesn't exist)
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
        }).then(() => {}).catch(() => {}); // ignore — notifications may be localStorage-only
      }

      setStatus('confirmed');
    } catch (err) {
      console.error('[ReturnConfirm] confirm error:', err);
      setValidationErr('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Shared styles ──────────────────────────────────────────────────────────
  const wrap  = { maxWidth: 600, margin: '0 auto', padding: '40px 24px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', color: '#0F172A' };
  const th    = { textAlign: 'left', padding: '7px 10px', fontWeight: 600, fontSize: 12, color: '#475569', borderBottom: '2px solid #E2E8F0', background: '#F8FAFC' };
  const td    = { padding: '8px 10px', fontSize: 13, borderBottom: '1px solid #F1F5F9', verticalAlign: 'middle' };

  const showOrdered = items.some(i => i.ordered_qty != null);

  // ── States ─────────────────────────────────────────────────────────────────

  if (status === 'loading') {
    return (
      <div style={{ ...wrap, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
        <div style={{ textAlign: 'center', color: '#94A3B8' }}>
          <div style={{ width: 32, height: 32, border: '3px solid #E2E8F0', borderTopColor: '#1E3A5F', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p style={{ margin: 0, fontSize: 14 }}>Loading…</p>
        </div>
      </div>
    );
  }

  if (status === 'not_found') {
    return (
      <div style={{ ...wrap, textAlign: 'center', paddingTop: 80 }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
        <h2 style={{ margin: '0 0 8px', color: '#1E3A5F' }}>Link not found</h2>
        <p style={{ color: '#64748B', fontSize: 14 }}>This confirmation link is invalid or has expired.</p>
        <p style={{ color: '#94A3B8', fontSize: 12, marginTop: 32 }}>Powered by Cargo (cargotechnology.app)</p>
      </div>
    );
  }

  if (status === 'already_confirmed') {
    return (
      <div style={wrap}>
        <Header vesselName={vesselName} orderRef={orderRef} supplierName={supplierName} />
        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, padding: '20px 24px', textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
          <h3 style={{ margin: '0 0 4px', color: '#065F46', fontSize: 17 }}>Already confirmed</h3>
          <p style={{ margin: 0, color: '#047857', fontSize: 13 }}>
            Confirmed by <strong>{confirmedBy}</strong> on{' '}
            {confirmedAt?.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <ItemsTable items={items} showOrdered={showOrdered} th={th} td={td} />
        <Footer />
      </div>
    );
  }

  if (status === 'confirmed') {
    return (
      <div style={wrap}>
        <Header vesselName={vesselName} orderRef={orderRef} supplierName={supplierName} />
        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, padding: '32px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <h2 style={{ margin: '0 0 8px', color: '#065F46', fontSize: 20 }}>Thank you — receipt confirmed</h2>
          <p style={{ margin: 0, color: '#047857', fontSize: 14 }}>
            Your confirmation has been sent to the vessel. You can close this page.
          </p>
        </div>
        <Footer />
      </div>
    );
  }

  // ── Ready state (main form) ────────────────────────────────────────────────
  return (
    <div style={wrap}>
      <Header vesselName={vesselName} orderRef={orderRef} supplierName={supplierName} />

      <ItemsTable items={items} showOrdered={showOrdered} th={th} td={td} />

      {/* Supplier signature section */}
      <div style={{ border: '1px solid #E2E8F0', borderRadius: 10, padding: '20px 20px 24px', marginBottom: 24 }}>
        <p style={{ margin: '0 0 16px', fontSize: 12, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Supplier Confirmation
        </p>

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
              padding: '9px 12px', fontSize: 14, color: '#0F172A',
              fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#64748B', marginBottom: 6 }}>
            Signature <span style={{ color: '#DC2626' }}>*</span>
          </label>
          <SignaturePad
            onSign={setSignature}
            sublabel="Draw your signature above"
          />
        </div>

        {validationErr && (
          <p style={{ margin: '12px 0 0', fontSize: 13, color: '#DC2626' }}>{validationErr}</p>
        )}
      </div>

      <button
        onClick={handleConfirm}
        disabled={submitting}
        style={{
          width: '100%', padding: '14px 0', background: submitting ? '#86EFAC' : '#059669',
          color: '#FFFFFF', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700,
          cursor: submitting ? 'default' : 'pointer', transition: 'background 0.2s',
          marginBottom: 24,
        }}
      >
        {submitting ? 'Confirming…' : 'Confirm Receipt'}
      </button>

      <Footer />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Header({ vesselName, orderRef, supplierName }) {
  return (
    <div style={{ background: '#1E3A5F', borderRadius: 10, padding: '20px 24px', marginBottom: 24, color: '#FFFFFF' }}>
      <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>
        Return Slip Confirmation
      </h1>
      <p style={{ margin: 0, fontSize: 13, color: '#93C5FD' }}>
        {vesselName || 'Vessel'}
        {orderRef ? ` · Order: ${orderRef}` : ''}
        {supplierName ? ` · ${supplierName}` : ''}
      </p>
    </div>
  );
}

function ItemsTable({ items, showOrdered, th, td }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Items for Return
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={th}>Description</th>
            {showOrdered && <th style={{ ...th, textAlign: 'center', width: 70 }}>Ordered</th>}
            <th style={{ ...th, textAlign: 'center', width: 80 }}>Delivered</th>
            <th style={{ ...th, textAlign: 'center', width: 80 }}>Return Qty</th>
            <th style={{ ...th, width: 140 }}>Reason</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id}>
              <td style={td}>{item.raw_name}</td>
              {showOrdered && <td style={{ ...td, textAlign: 'center', color: '#64748B' }}>{item.ordered_qty ?? '—'}</td>}
              <td style={{ ...td, textAlign: 'center' }}>{item.quantity ?? '—'}{item.unit ? ` ${item.unit}` : ''}</td>
              <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>{item.return_qty ?? item.quantity}</td>
              <td style={{ ...td, color: '#475569' }}>{item.return_reason || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Footer() {
  return (
    <p style={{ textAlign: 'center', fontSize: 11, color: '#94A3B8', marginTop: 32 }}>
      Powered by Cargo (cargotechnology.app)
    </p>
  );
}

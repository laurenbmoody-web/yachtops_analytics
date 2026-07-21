import React, { useEffect, useMemo, useState } from 'react';
import { Banknote, CheckCircle2, ExternalLink } from 'lucide-react';
import { startStripeConnectOnboarding } from '../utils/supplierStorage';

// Stripe Connect (Express) onboarding for a supplier — the "Payment & banking"
// tab. Card acceptance is an added path: bank transfer stays available either
// way. The supplier is merchant of record and bears the fees.
export default function ConnectPaymentSettings({ supplier, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const state = useMemo(() => {
    if (supplier?.stripe_charges_enabled) return 'ready';
    if (supplier?.stripe_account_id) return 'incomplete';
    return 'none';
  }, [supplier?.stripe_charges_enabled, supplier?.stripe_account_id]);

  // Returning from Stripe-hosted onboarding — the account.updated webhook flips
  // the flags a moment later, so refresh the profile shortly after landing.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('stripe') === 'return' || p.get('stripe') === 'refresh') {
      const t = setTimeout(() => onSaved?.(), 1500);
      return () => clearTimeout(t);
    }
  }, [onSaved]);

  const connect = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const url = await startStripeConnectOnboarding();
      window.location.href = url;
    } catch (e) {
      setError(e.message || 'Could not start Stripe onboarding.');
      setBusy(false);
    }
  };

  const meta = {
    ready:      { label: 'Ready to accept cards', tone: '#0F7B4F', bg: '#ECFdf3', border: '#BBF7D0' },
    incomplete: { label: 'Onboarding incomplete',  tone: '#B14E16', bg: '#FBEFE9', border: '#F3D9CB' },
    none:       { label: 'Not connected',          tone: '#6B7280', bg: 'var(--ground, #FAFAF8)', border: 'var(--line, #ECEAE3)' },
  }[state];

  const cta = state === 'ready' ? 'Update Stripe details' : state === 'incomplete' ? 'Finish onboarding →' : 'Connect Stripe →';

  return (
    <>
      <h4 style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 15, color: 'var(--fg)', margin: '0 0 4px' }}>
        Card payments
      </h4>
      <p style={{ fontSize: 12.5, color: 'var(--muted-strong)', margin: '0 0 22px', lineHeight: 1.5, maxWidth: 560 }}>
        Let yachts pay your invoices by card. Payments go straight to your Stripe account —
        you’re the merchant of record. Cargo takes a small platform fee and you bear the Stripe
        processing fee; the net lands in your Stripe balance. Bank transfer stays available regardless.
      </p>

      {error && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 13, color: 'var(--red, #B42318)' }}>
          {error}
        </div>
      )}

      <div style={{
        border: '1px solid var(--line, #ECEAE3)', borderRadius: 12, padding: 18,
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div style={{
          width: 42, height: 42, borderRadius: 10, flexShrink: 0,
          background: '#635BFF', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {state === 'ready' ? <CheckCircle2 size={20} /> : <Banknote size={20} />}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--fg)' }}>Stripe</div>
          <span style={{
            display: 'inline-block', marginTop: 4, padding: '2px 10px', borderRadius: 999,
            fontSize: 11, fontWeight: 600, color: meta.tone, background: meta.bg, border: `1px solid ${meta.border}`,
          }}>{meta.label}</span>
          {state === 'incomplete' && (
            <div style={{ fontSize: 11.5, color: 'var(--muted-strong)', marginTop: 6, lineHeight: 1.45 }}>
              Stripe still needs a few details before you can take cards. Pick up where you left off.
            </div>
          )}
        </div>
        <button
          type="button"
          className="sp-btn sp-btn-primary"
          onClick={connect}
          disabled={busy}
          style={{ marginLeft: 'auto', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          {busy ? 'Opening Stripe…' : cta}
          {state === 'ready' && !busy && <ExternalLink size={13} />}
        </button>
      </div>

      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 12, lineHeight: 1.5, maxWidth: 560 }}>
        Onboarding, identity checks and payouts are handled by Stripe. You can return here any time to
        update your details.
      </p>
    </>
  );
}

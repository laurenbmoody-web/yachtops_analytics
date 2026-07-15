import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { getMyContext } from '../../utils/authHelpers';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';

// ─── Plan reference data ─────────────────────────────────────────────────────
// Pricing is by vessel length. Every crew member and app user is included —
// there are no per-seat fees. The authoritative amount lives in Stripe; these
// are the list prices shown for reference.
const TIERS = {
  under_40m: { label: 'Under 40m', price: 179 },
  '40_80m': { label: '40 – 80m', price: 279 },
  over_80m: { label: 'Over 80m', price: 399 },
};
const SUPPORT = {
  under_40m: 'Self-serve onboarding & email support',
  '40_80m': 'Guided onboarding & priority email support',
  over_80m: 'Dedicated onboarding & priority support',
};
const INCLUDED = [
  'Every crew member & app user — no per-seat fees',
  'Inventory, provisioning & supplier orders',
  'Crew records, rotas & Hours of Rest',
  'Guest management, preferences & trips',
  'Sea-service tracking & testimonials',
  'Document vault & crew certificates',
  'Compliance & month-end packs',
];

const STATUS = {
  active: { label: 'Active', bg: '#E7F2EA', fg: '#3F7A52' },
  trialing: { label: 'Trial', bg: '#FBEFD9', fg: '#8A5A12' },
  past_due: { label: 'Payment due', bg: '#FBE4DC', fg: '#9A2B12' },
  incomplete: { label: 'Payment needed', bg: '#FBE4DC', fg: '#9A2B12' },
  incomplete_expired: { label: 'Payment needed', bg: '#FBE4DC', fg: '#9A2B12' },
  canceled: { label: 'Cancelled', bg: '#F0F1F5', fg: '#8B8478' },
};

const card = { background: '#fff', border: '1px solid #ECEAE3', borderRadius: 16, padding: '24px 26px' };
const caps = { fontSize: 9, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#8B8478' };

const Membership = () => {
  const navigate = useNavigate();
  const { isVesselAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [noTenantAccess, setNoTenantAccess] = useState(false);
  const [tenantId, setTenantId] = useState(null);
  const [plan, setPlan] = useState({ tier: null, period: 'monthly', status: null, vessel: '' });
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalMsg, setPortalMsg] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);

  useEffect(() => { (async () => {
    try {
      const { tenantId: tid } = await getMyContext();
      if (!tid) { setNoTenantAccess(true); setLoading(false); return; }
      setTenantId(tid);
      const { data } = await supabase.from('tenants')
        .select('name, plan_tier, billing_period, subscription_status')
        .eq('id', tid).maybeSingle();
      setPlan({
        tier: data?.plan_tier || null,
        period: data?.billing_period || 'monthly',
        status: data?.subscription_status || null,
        vessel: data?.name || '',
      });
    } catch (e) {
      console.error('[membership] load failed', e);
    } finally {
      setLoading(false);
    }
  })(); }, []);

  // Open Stripe's Customer Portal (payment method, invoices, cancellation).
  const openPortal = async (flow) => {
    if (portalBusy) return;
    setPortalBusy(true); setPortalMsg('');
    try {
      const { data, error } = await supabase.functions.invoke('create-billing-portal-session', {
        body: { tenant_id: tenantId, flow: flow || null, return_url: window.location.href },
      });
      const err = data?.error || error?.message;
      if (err === 'no_customer' || err === 'billing_not_configured') {
        setPortalMsg('Billing isn’t set up for this vessel yet. Once your subscription is active you’ll manage payment, invoices and cancellation here.');
        return;
      }
      if (err || !data?.url) throw new Error(err || 'failed');
      window.location.href = data.url;
    } catch (e) {
      console.warn('[membership] portal failed', e);
      setPortalMsg('Couldn’t open billing just now — please try again.');
    } finally {
      setPortalBusy(false);
    }
  };

  const tierInfo = plan.tier ? TIERS[plan.tier] : null;
  const st = STATUS[plan.status] || STATUS.trialing;

  if (loading) {
    return (
      <><Header /><div style={{ minHeight: 'calc(100vh - 64px)', display: 'grid', placeItems: 'center', color: '#8B8478' }}>Loading…</div></>
    );
  }
  if (noTenantAccess) {
    return (
      <><Header /><div style={{ minHeight: 'calc(100vh - 64px)', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24 }}>
        <div>
          <Icon name="AlertCircle" size={40} color="#C65A1A" />
          <h2 style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 24, color: '#1C1B3A', margin: '12px 0 6px' }}>No active vessel</h2>
          <p style={{ color: '#6B7280', fontSize: 14 }}>Membership belongs to a vessel — join or set one up to see a plan.</p>
        </div>
      </div></>
    );
  }

  return (
    <>
      <Header />
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '28px 24px 64px', fontFamily: "'Inter', system-ui, sans-serif" }}>
        <button type="button" onClick={() => navigate('/settings')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#8B8478', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 18 }}>
          <Icon name="ChevronLeft" size={16} /> Back to Settings
        </button>

        <div style={caps}>Membership</div>
        <h1 style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 32, color: '#1C1B3A', margin: '4px 0 24px', lineHeight: 1.1 }}>
          Your <em style={{ color: '#C65A1A' }}>plan</em>.
        </h1>

        {/* Plan card — visible to everyone on the vessel */}
        <div style={{ ...card, marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={caps}>{plan.vessel || 'This vessel'}</div>
              <div style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 26, color: '#1C1B3A', marginTop: 4 }}>
                {tierInfo ? `Cargo — ${tierInfo.label}` : 'Cargo — Free trial'}
              </div>
              {tierInfo ? (
                <div style={{ fontSize: 15, color: '#1C1B3A', marginTop: 6 }}>
                  <strong>£{tierInfo.price}</strong><span style={{ color: '#8B8478' }}>/month{plan.period === 'annual' ? ' · billed annually' : ''}</span>
                </div>
              ) : (
                <div style={{ fontSize: 14, color: '#8B8478', marginTop: 6 }}>No paid plan yet.</div>
              )}
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', padding: '4px 10px', borderRadius: 999, background: st.bg, color: st.fg }}>{st.label}</span>
          </div>

          <div style={{ height: 1, background: '#F0F1F5', margin: '20px 0' }} />

          <div style={{ ...caps, marginBottom: 12 }}>What’s included</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 9 }}>
            {INCLUDED.map((f) => (
              <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13.5, color: '#4B4B63' }}>
                <span style={{ color: '#3F7A52', flex: '0 0 auto', marginTop: 1 }}><Icon name="Check" size={15} /></span>{f}
              </li>
            ))}
            {tierInfo && (
              <li style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13.5, color: '#4B4B63' }}>
                <span style={{ color: '#3F7A52', flex: '0 0 auto', marginTop: 1 }}><Icon name="Check" size={15} /></span>{SUPPORT[plan.tier]}
              </li>
            )}
          </ul>
        </div>

        {/* Billing — vessel admin only */}
        {isVesselAdmin ? (
          <div style={card}>
            <div style={{ ...caps, marginBottom: 4 }}>Billing</div>
            <p style={{ fontSize: 13.5, color: '#6B7280', lineHeight: 1.6, margin: '0 0 16px' }}>
              Manage your payment method, download invoices, and cancel — all in Cargo’s secure billing (powered by Stripe).
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => openPortal(null)} disabled={portalBusy}
                style={{ fontSize: 14, fontWeight: 600, color: '#fff', background: '#C65A1A', border: 'none', borderRadius: 10, padding: '10px 16px', cursor: 'pointer' }}>
                {portalBusy ? 'Opening…' : 'Manage billing'}
              </button>
              <button type="button" onClick={() => setCancelOpen(true)} disabled={portalBusy}
                style={{ fontSize: 14, fontWeight: 600, color: '#9A2B12', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '10px 16px', cursor: 'pointer' }}>
                Cancel membership
              </button>
            </div>
            {portalMsg && <p style={{ fontSize: 13, color: '#8B8478', marginTop: 12, lineHeight: 1.5 }}>{portalMsg}</p>}
          </div>
        ) : (
          <div style={{ ...card, background: '#FAFAF8' }}>
            <div style={{ fontSize: 13.5, color: '#6B7280', lineHeight: 1.6 }}>
              Billing is managed by your vessel’s admin. You have full access as part of the vessel’s plan — every crew member and app user is included.
            </div>
          </div>
        )}
      </div>

      {/* Cancel — step-through confirmation, then Stripe's cancel flow */}
      {cancelOpen && (
        <div onClick={() => !portalBusy && setCancelOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(28,27,58,0.32)', display: 'grid', placeItems: 'center', padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', border: '1px solid #ECEAE3', borderRadius: 16, boxShadow: '0 24px 60px -16px rgba(28,27,58,0.32)', width: '100%', maxWidth: 460, padding: '26px 26px 22px' }}>
            <h2 style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 22, color: '#1C1B3A', margin: '0 0 12px' }}>Cancel membership?</h2>
            <ul style={{ listStyle: 'none', margin: '0 0 18px', padding: 0, display: 'grid', gap: 10 }}>
              {[
                'You keep full access until the end of your current billing period.',
                'No cancellation fee, and you won’t be charged again.',
                'After that date, Cargo stops for everyone on the vessel — crew lose access to vessel features.',
                'Your crew keep their personal records; those travel with them.',
              ].map((t) => (
                <li key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13.5, color: '#4B4B63', lineHeight: 1.5 }}>
                  <span style={{ color: '#C65A1A', flex: '0 0 auto', marginTop: 1 }}><Icon name="Dot" size={16} /></span>{t}
                </li>
              ))}
            </ul>
            {portalMsg && <p style={{ fontSize: 13, color: '#9A2B12', margin: '0 0 12px', lineHeight: 1.5 }}>{portalMsg}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => setCancelOpen(false)} disabled={portalBusy}
                style={{ fontSize: 14, fontWeight: 600, color: '#1C1B3A', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '10px 16px', cursor: 'pointer' }}>
                Keep membership
              </button>
              <button type="button" onClick={() => openPortal('cancel')} disabled={portalBusy}
                style={{ fontSize: 14, fontWeight: 600, color: '#fff', background: '#9A2B12', border: 'none', borderRadius: 10, padding: '10px 16px', cursor: 'pointer' }}>
                {portalBusy ? 'Opening…' : 'Continue to cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Membership;

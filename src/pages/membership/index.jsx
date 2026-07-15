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

const caps = { fontSize: 9, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#8B8478' };
const hair = { height: 1, background: '#F0F1F5', border: 'none', margin: '30px 0' };
const PERIOD_LABEL = (p) => (p === 'annual' ? '/year · billed annually' : '/month');

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
  const [selTier, setSelTier] = useState('under_40m');
  const [selPeriod, setSelPeriod] = useState('monthly');
  const [upgradeBusy, setUpgradeBusy] = useState(false);
  const [banner, setBanner] = useState(null); // { tone, text }

  // Returning from Stripe checkout (success / cancel).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('upgraded') === '1') setBanner({ tone: 'ok', text: 'Payment received — your plan is being activated. It’ll show as Active here in a moment.' });
    else if (p.get('cancelled') === '1') setBanner({ tone: 'warn', text: 'Checkout cancelled — no charge was made. You can pick a plan whenever you’re ready.' });
    if (p.get('upgraded') || p.get('cancelled')) window.history.replaceState({}, '', window.location.pathname);
  }, []);

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

  // Start a Stripe Checkout to move this vessel onto a paid plan.
  const startUpgrade = async () => {
    if (upgradeBusy) return;
    setUpgradeBusy(true); setPortalMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch('/api/create-upgrade-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` },
        body: JSON.stringify({ tenant_id: tenantId, tier: selTier, billing_period: selPeriod }),
      });
      const data = await res.json().catch(() => null);
      if (data?.error === 'already_active') { setBanner({ tone: 'warn', text: 'You’re already on a paid plan — use Manage billing to change it.' }); return; }
      if (!res.ok || !data?.url) throw new Error(data?.error || 'failed');
      window.location.href = data.url;
    } catch (e) {
      console.warn('[membership] upgrade failed', e);
      setBanner({ tone: 'warn', text: 'Couldn’t start the upgrade just now — please try again.' });
    } finally {
      setUpgradeBusy(false);
    }
  };

  const tierInfo = plan.tier ? TIERS[plan.tier] : null;
  const st = STATUS[plan.status] || STATUS.trialing;
  const isPaid = !!(plan.tier && plan.status === 'active');

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

        <div style={caps}>{plan.vessel || 'Membership'}</div>
        <h1 style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 40, color: '#1C1B3A', margin: '6px 0 0', lineHeight: 1.05, letterSpacing: '-0.5px' }}>
          {tierInfo ? <>Cargo <span style={{ color: '#AEB4C2' }}>—</span> <em style={{ fontStyle: 'italic', color: '#C65A1A' }}>{tierInfo.label}</em></> : <>Cargo <em style={{ fontStyle: 'italic', color: '#C65A1A' }}>free trial</em></>}
        </h1>

        {banner && (
          <div style={{
            marginTop: 16, borderRadius: 12, padding: '12px 15px', fontSize: 13.5, lineHeight: 1.5,
            background: banner.tone === 'ok' ? '#E7F2EA' : '#FBEFD9',
            border: `1px solid ${banner.tone === 'ok' ? '#CDE6D5' : '#F0DCB0'}`,
            color: banner.tone === 'ok' ? '#2F6B43' : '#8A5A12',
          }}>{banner.text}</div>
        )}

        {/* Price + status — editorial line, no box */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginTop: 14 }}>
          {tierInfo ? (
            <div style={{ fontSize: 17, color: '#1C1B3A' }}>
              <strong style={{ fontSize: 22 }}>£{tierInfo.price}</strong>
              <span style={{ color: '#8B8478', fontSize: 15 }}>{PERIOD_LABEL(plan.period)}</span>
            </div>
          ) : (
            <div style={{ fontSize: 15, color: '#8B8478' }}>No paid plan yet.</div>
          )}
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '3px 10px', borderRadius: 999, background: st.bg, color: st.fg }}>{st.label}</span>
        </div>

        <hr style={hair} />

        {/* What's included — editorial two-column list */}
        <div style={{ ...caps, marginBottom: 16 }}>What’s included</div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '11px 24px' }}>
          {INCLUDED.map((f) => (
            <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 14, color: '#4B4B63', lineHeight: 1.45 }}>
              <span style={{ color: '#3F7A52', flex: '0 0 auto', marginTop: 1 }}><Icon name="Check" size={15} /></span>{f}
            </li>
          ))}
          {tierInfo && (
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 14, color: '#4B4B63', lineHeight: 1.45 }}>
              <span style={{ color: '#3F7A52', flex: '0 0 auto', marginTop: 1 }}><Icon name="Check" size={15} /></span>{SUPPORT[plan.tier]}
            </li>
          )}
        </ul>

        <hr style={hair} />

        {/* Choose a plan — vessel admin, not yet on a paid plan. Editorial:
            no display box; the tier tiles are selection controls. */}
        {isVesselAdmin && !isPaid && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={caps}>{plan.tier ? 'Change your plan' : 'Choose your plan'}</div>
              {/* Monthly / annual toggle */}
              <div style={{ display: 'inline-flex', background: '#F6F5F2', border: '1px solid #ECEAE3', borderRadius: 999, padding: 3 }}>
                {[['monthly', 'Monthly'], ['annual', 'Annual']].map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setSelPeriod(v)}
                    style={{ fontSize: 12.5, fontWeight: 600, border: 'none', cursor: 'pointer', borderRadius: 999, padding: '5px 14px',
                      background: selPeriod === v ? '#fff' : 'transparent', color: selPeriod === v ? '#1C1B3A' : '#8B8478',
                      boxShadow: selPeriod === v ? '0 1px 2px rgba(28,27,58,0.12)' : 'none' }}>{l}</button>
                ))}
              </div>
            </div>
            <p style={{ fontSize: 13, color: '#8B8478', margin: '8px 0 16px', lineHeight: 1.5 }}>
              Every crew member and app user is included — no per-seat fees. Pricing is by vessel length.
            </p>

            <div style={{ display: 'grid', gap: 10 }}>
              {Object.entries(TIERS).map(([key, t]) => {
                const on = selTier === key;
                return (
                  <button key={key} type="button" onClick={() => setSelTier(key)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, textAlign: 'left', cursor: 'pointer',
                      border: `1.5px solid ${on ? '#C65A1A' : '#ECEAE3'}`, background: on ? '#FBEFE9' : '#fff', borderRadius: 12, padding: '13px 15px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ width: 18, height: 18, borderRadius: 999, flex: 'none', border: `2px solid ${on ? '#C65A1A' : '#CBC9C0'}`, display: 'grid', placeItems: 'center' }}>
                        {on && <span style={{ width: 8, height: 8, borderRadius: 999, background: '#C65A1A' }} />}
                      </span>
                      <span>
                        <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: '#1C1B3A' }}>Cargo — {t.label}</span>
                        <span style={{ display: 'block', fontSize: 12, color: '#8B8478', marginTop: 1 }}>{SUPPORT[key]}</span>
                      </span>
                    </span>
                    <span style={{ flex: 'none', textAlign: 'right' }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: '#1C1B3A' }}>£{t.price}</span>
                      <span style={{ fontSize: 12, color: '#8B8478' }}>/mo</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <button type="button" onClick={startUpgrade} disabled={upgradeBusy}
              style={{ marginTop: 16, width: '100%', fontSize: 14.5, fontWeight: 600, color: '#fff', background: '#C65A1A', border: 'none', borderRadius: 10, padding: '12px 16px', cursor: upgradeBusy ? 'default' : 'pointer', opacity: upgradeBusy ? 0.7 : 1 }}>
              {upgradeBusy ? 'Starting secure checkout…' : `Continue to payment${selPeriod === 'annual' ? ' · billed annually' : ''}`}
            </button>
            <p style={{ fontSize: 12, color: '#AEB4C2', textAlign: 'center', margin: '10px 0 0', lineHeight: 1.5 }}>
              Secure checkout powered by Stripe. Cancel anytime. The exact total (incl. any annual discount) is shown before you pay.
            </p>
          </>
        )}

        {/* Billing management — admin on a paid plan. On trial the chooser above
            is the action, so there's nothing to manage yet. */}
        {isVesselAdmin && isPaid && (
          <>
            <div style={{ ...caps, marginBottom: 6 }}>Billing</div>
            <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6, margin: '0 0 18px', maxWidth: 520 }}>
              Manage your payment method, download invoices, and cancel — all in Cargo’s secure billing, powered by Stripe.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => openPortal(null)} disabled={portalBusy}
                style={{ fontSize: 14, fontWeight: 600, color: '#fff', background: '#C65A1A', border: 'none', borderRadius: 10, padding: '11px 18px', cursor: portalBusy ? 'default' : 'pointer' }}>
                {portalBusy ? 'Opening…' : 'Manage billing'}
              </button>
              <button type="button" onClick={() => setCancelOpen(true)} disabled={portalBusy}
                style={{ fontSize: 14, fontWeight: 600, color: '#9A2B12', background: '#fff', border: '1px solid #E8E6DF', borderRadius: 10, padding: '11px 18px', cursor: portalBusy ? 'default' : 'pointer' }}>
                Cancel membership
              </button>
            </div>
            {portalMsg && <p style={{ fontSize: 13, color: '#8B8478', marginTop: 14, lineHeight: 1.5, maxWidth: 520 }}>{portalMsg}</p>}
          </>
        )}

        {/* Crew — billing is the admin's concern; reassure they're covered. */}
        {!isVesselAdmin && (
          <>
            <div style={{ ...caps, marginBottom: 6 }}>Billing</div>
            <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6, margin: 0, maxWidth: 560 }}>
              Billing is managed by your vessel’s admin. You have full access as part of the vessel’s plan — every crew member and app user is included, with no per-seat fees.
            </p>
          </>
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

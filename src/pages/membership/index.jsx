import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { getMyContext } from '../../utils/authHelpers';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import './membership.css';

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

const PERIOD_LABEL = (p) => (p === 'annual' ? '/year · billed annually' : '/month');
// dd/mm/yyyy — Cargo date convention.
const fmtDate = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}`;
};

const Membership = () => {
  const navigate = useNavigate();
  const { isVesselAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [noTenantAccess, setNoTenantAccess] = useState(false);
  const [tenantId, setTenantId] = useState(null);
  const [plan, setPlan] = useState({ tier: null, period: 'monthly', status: null, vessel: '', joined: null, periodEnd: null, cancelAtEnd: false });
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
        .select('name, plan_tier, billing_period, subscription_status, created_at, current_period_end, cancel_at_period_end')
        .eq('id', tid).maybeSingle();
      setPlan({
        tier: data?.plan_tier || null,
        period: data?.billing_period || 'monthly',
        status: data?.subscription_status || null,
        vessel: data?.name || '',
        joined: data?.created_at || null,
        periodEnd: data?.current_period_end || null,
        cancelAtEnd: data?.cancel_at_period_end || false,
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
  // Portal "cancel at period end" keeps status active but flags the wind-down.
  const cancelling = !!(plan.cancelAtEnd && isPaid);
  const periodEndLabel = plan.periodEnd ? fmtDate(plan.periodEnd) : '';
  const CANCELLING_PILL = { label: 'Cancelling', bg: '#FBEFD9', fg: '#8A5A12' };
  const cardPill = cancelling ? CANCELLING_PILL : st;

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
      <div className="mem-page">
        <button type="button" className="mem-back" onClick={() => navigate('/settings')}>Back to settings</button>

        {/* Eyebrow meta — vessel · member since · billing cadence */}
        <p className="mem-meta">
          <span className="dot">●</span>
          <span>{plan.vessel || 'This vessel'}</span>
          {plan.joined && <><span className="bar" /><span className="muted">Member since {fmtDate(plan.joined)}</span></>}
          {tierInfo && <><span className="bar" /><span className="muted">Billed {plan.period === 'annual' ? 'annually' : 'monthly'}</span></>}
          {cancelling && periodEndLabel
            ? <><span className="bar" /><span className="muted">Cancels {periodEndLabel}</span></>
            : (isPaid && periodEndLabel && <><span className="bar" /><span className="muted">Renews {periodEndLabel}</span></>)}
        </p>

        {/* Headline — VESSEL, *Membership*. (plan detail lives in the card) */}
        <h1 className="mem-headline">
          Vessel<span className="comma">,</span> <em>Membership</em>
        </h1>

        {banner && (
          <div className="mem-banner" style={{
            background: banner.tone === 'ok' ? '#E7F2EA' : '#FBEFD9',
            border: `1px solid ${banner.tone === 'ok' ? '#CDE6D5' : '#F0DCB0'}`,
            color: banner.tone === 'ok' ? '#2F6B43' : '#8A5A12',
          }}>{banner.text}</div>
        )}

        <div className="mem-grid">
          {/* ── Plan card — the active subscription, shown "selected" ── */}
          <div className={`mem-card${isPaid ? ' is-current' : ''}`}>
            <div className="mem-card-top">
              <div>
                <div className="mem-plan-name">
                  {tierInfo ? <>Cargo <span className="dash">—</span> {tierInfo.label}</> : 'Cargo — Free trial'}
                </div>
                {tierInfo ? (
                  <div className="mem-price">
                    <strong>£{tierInfo.price}</strong><span className="per">{PERIOD_LABEL(plan.period)}</span>
                  </div>
                ) : (
                  <div className="mem-price"><span className="per">No paid plan yet.</span></div>
                )}
              </div>
              <span className="mem-status" style={{ background: cardPill.bg, color: cardPill.fg }}>{cardPill.label}</span>
            </div>

            {cancelling && (
              <div className="mem-cancel-note">
                Cancelling{periodEndLabel ? ` on ${periodEndLabel}` : ' at the end of your billing period'} — you keep full access until then. Reactivate any time from Manage billing.
              </div>
            )}

            <hr className="mem-card-hr" />

            <div className="mem-caps">What’s included</div>
            <ul className="mem-inc">
              {INCLUDED.map((f) => (
                <li key={f}><span className="tick"><Icon name="Check" size={15} /></span>{f}</li>
              ))}
              {tierInfo && (
                <li><span className="tick"><Icon name="Check" size={15} /></span>{SUPPORT[plan.tier]}</li>
              )}
            </ul>
          </div>

          {/* ── Choose a plan — vessel admin, not yet on a paid plan ── */}
          {isVesselAdmin && !isPaid && (
            <div className="mem-card">
              <div className="mem-choose-head">
                <div className="mem-caps">{plan.tier ? 'Change your plan' : 'Choose your plan'}</div>
                <div className="mem-toggle">
                  {[['monthly', 'Monthly'], ['annual', 'Annual']].map(([v, l]) => (
                    <button key={v} type="button" className={selPeriod === v ? 'on' : ''} onClick={() => setSelPeriod(v)}>{l}</button>
                  ))}
                </div>
              </div>
              <p className="mem-sec-desc" style={{ margin: '8px 0 4px' }}>
                Every crew member and app user is included — no per-seat fees. Pricing is by vessel length.
              </p>
              <div className="mem-tiers">
                {Object.entries(TIERS).map(([key, t]) => {
                  const on = selTier === key;
                  return (
                    <button key={key} type="button" className={`mem-tier${on ? ' on' : ''}`} onClick={() => setSelTier(key)}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span className="mem-tier-radio">{on && <i />}</span>
                        <span>
                          <span className="mem-tier-name">Cargo — {t.label}</span>
                          <span className="mem-tier-sub">{SUPPORT[key]}</span>
                        </span>
                      </span>
                      <span className="mem-tier-price"><b>£{t.price}</b><span>/mo</span></span>
                    </button>
                  );
                })}
              </div>
              <button type="button" className="mem-checkout-btn" onClick={startUpgrade} disabled={upgradeBusy}>
                {upgradeBusy ? 'Starting secure checkout…' : `Continue to payment${selPeriod === 'annual' ? ' · billed annually' : ''}`}
              </button>
              <p className="mem-secure">
                Secure checkout powered by Stripe. Cancel anytime. The exact total (incl. any annual discount) is shown before you pay.
              </p>
            </div>
          )}

          {/* ── Billing — admin on a paid plan ── */}
          {isVesselAdmin && isPaid && (
            <div className="mem-card">
              <div className="mem-caps">Billing</div>
              <p className="mem-sec-desc">
                Manage your payment method, download invoices, and cancel — all in Cargo’s secure billing, powered by Stripe.
              </p>
              <div className="mem-actions">
                <button type="button" className="mem-btn mem-btn-primary" onClick={() => openPortal(null)} disabled={portalBusy}>
                  {portalBusy ? 'Opening…' : 'Manage billing'}
                </button>
                <button type="button" className="mem-btn mem-btn-ghost" onClick={() => setCancelOpen(true)} disabled={portalBusy}>
                  Cancel membership
                </button>
              </div>
              {portalMsg && <p className="mem-note">{portalMsg}</p>}
            </div>
          )}

          {/* ── Crew — billing managed by admin ── */}
          {!isVesselAdmin && (
            <div className="mem-card">
              <div className="mem-caps">Billing</div>
              <p className="mem-sec-desc" style={{ margin: '6px 0 0' }}>
                Billing is managed by your vessel’s admin. You have full access as part of the vessel’s plan — every crew member and app user is included, with no per-seat fees.
              </p>
            </div>
          )}
        </div>
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

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';
import useScrollAnimations from '../../hooks/useScrollAnimations';
import TermsAcceptance, { isTermsAcceptanceValid } from '../../components/billing/TermsAcceptance';
import '../../styles/editorial.css';
import './checkout.css';

/* ─── Constants ─────────────────────────────────────────────────────────── */

// These mirror the TIER_INFO / FEATURES used on /pricing so the checkout
// summary stays visually consistent with the step-4 reveal. Kept local to
// this file rather than imported — /pricing's export surface doesn't need
// to grow for this.
const TIER_INFO = {
  under_40m: {
    label: 'Under 40m',
    monthly: 179,
    annual: 179 * 12 - 179 * 2, // 2 months free on annual
    support: 'Self-serve onboarding with documentation. Email support.',
  },
  '40_80m': {
    label: '40 – 80m',
    monthly: 279,
    annual: 279 * 12 - 279 * 2,
    support:
      'Guided onboarding session to set up your vessel structure, locations, and departments. Priority email support.',
  },
  over_80m: {
    label: 'Over 80m',
    monthly: 399,
    annual: 399 * 12 - 399 * 2,
    support:
      'Dedicated onboarding with data migration assistance. Priority support with direct access to the founder.',
  },
};

const INCLUDED = [
  'Every module — inventory, provisioning, guest profiles, trips, crew, defects',
  'Unlimited crew accounts',
  'AI document scanning on every plan',
  'Real-time currency conversion',
  'No per-seat charges, no add-ons',
];

/* ─── Small primitives ──────────────────────────────────────────────────── */

const Tick = () => (
  <span className="ck-tick" aria-hidden="true">
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </span>
);

/* ─── Page ──────────────────────────────────────────────────────────────── */

const CheckoutPage = () => {
  useScrollAnimations();
  const location = useLocation();
  const navigate = useNavigate();

  // State comes from the /pricing flow's navigate('/checkout', { state: ... }).
  // A hard refresh wipes it — see the "missing state" guard below.
  const state = location.state || {};
  const {
    vesselRegistrationId,
    verifiedVessel,
    pricingTier,
    contact,
    willBeAdmin,
  } = state;

  const cancelled = useMemo(
    () => new URLSearchParams(location.search).get('cancelled') === '1',
    [location.search]
  );

  const [billingPeriod, setBillingPeriod] = useState('monthly');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  // Who the vessel is billed to + the Terms tick box (recorded server-side).
  const [terms, setTerms] = useState({ legalName: '', country: '', accepted: false });

  // If the user landed here by URL (no state), bounce them back to /pricing
  // — we can't create a checkout session without the registration id. Using
  // an effect so the navigation happens after render instead of during it.
  useEffect(() => {
    if (!vesselRegistrationId || !pricingTier) {
      navigate('/pricing', { replace: true });
    }
  }, [vesselRegistrationId, pricingTier, navigate]);

  if (!vesselRegistrationId || !pricingTier) {
    return null; // effect above will redirect; render nothing in the meantime
  }

  const tier = TIER_INFO[pricingTier];
  if (!tier) {
    // Unknown tier slug — shouldn't happen in practice, but we guard rather
    // than render NaN prices. Push back to /pricing to re-verify.
    return (
      <MarketingLayout>
        <section className="ck-page ck-empty">
          <p>We couldn’t load your plan. Please start from the pricing page.</p>
          <Link to="/pricing" className="ck-back">Back to pricing</Link>
        </section>
      </MarketingLayout>
    );
  }

  const price = billingPeriod === 'annual' ? tier.annual : tier.monthly;
  const priceSuffix = billingPeriod === 'annual' ? '/year' : '/month';
  const ready = isTermsAcceptanceValid(terms);

  const handleSubmit = async () => {
    if (!ready) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vessel_registration_id: vesselRegistrationId,
          billing_period: billingPeriod,
          contact: contact || undefined,
          will_be_admin: willBeAdmin !== false, // default true if unset
          accept_terms: terms.accepted === true,
          customer: { legal_name: terms.legalName, country: terms.country },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.url) {
        setError(
          data?.error ||
            'We couldn’t start checkout. Please try again, or contact support if it keeps happening.'
        );
        setSubmitting(false);
        return;
      }
      // Full-page redirect to Stripe's hosted checkout. Using window.location
      // rather than a new tab so the browser back-button lands them on /pricing
      // if they bail out.
      window.location.href = data.url;
    } catch (err) {
      console.error('create-checkout-session exception:', err);
      setError('Something went wrong starting checkout. Please try again.');
      setSubmitting(false);
    }
  };

  const vesselBits = [
    verifiedVessel?.loa_metres ? `${verifiedVessel.loa_metres}m` : null,
    verifiedVessel?.type || null,
    verifiedVessel?.flag || null,
  ].filter(Boolean);

  return (
    <MarketingLayout>
      <section className="ck-page">
        <Link to="/pricing" className="ck-back">Back to pricing</Link>

        <p className="editorial-meta">
          <span className="dot">●</span>
          <span>Checkout</span>
          <span className="bar" />
          <span className="muted">{verifiedVessel?.name || 'Your vessel'}</span>
          <span className="bar" />
          <span className="muted">{tier.label}</span>
        </p>
        <h1 className="editorial-greeting">
          Subscription<span className="period">,</span> <em>almost there</em><span className="period">.</span>
        </h1>
        <p className="ck-lede">
          Confirm your plan and who it’s billed to. You’ll enter payment details securely with Stripe, and we’ll
          email you a link to set up your account as soon as payment clears.
        </p>

        {cancelled && (
          <div className="ck-banner">
            You cancelled the Stripe checkout. No charge was made — confirm your plan below whenever you’re ready.
          </div>
        )}

        <div className="ck-grid">
          {/* ── Plan summary ── */}
          <div className="ck-card is-current">
            <div className="ck-caps">Your vessel</div>
            <div className="ck-vessel">{verifiedVessel?.name || 'Your vessel'}</div>
            {vesselBits.length > 0 && <div className="ck-sub">{vesselBits.join(' · ')}</div>}

            <hr className="ck-hr" />

            <div className="ck-plan-head">
              <div>
                <div className="ck-caps">Your plan</div>
                <div className="ck-plan-name">Cargo <span className="dash">·</span> {tier.label}</div>
              </div>
              <div className="ck-toggle" role="group" aria-label="Billing period">
                {[['monthly', 'Monthly'], ['annual', 'Annual']].map(([p, l]) => (
                  <button key={p} type="button" className={billingPeriod === p ? 'on' : ''} onClick={() => setBillingPeriod(p)}>{l}</button>
                ))}
              </div>
            </div>
            <div className="ck-price">
              <strong>£{price.toLocaleString('en-GB')}</strong><span className="per">{priceSuffix}</span>
            </div>
            <div className="ck-sub">
              {billingPeriod === 'annual' ? 'Two months free vs paying monthly · ' : ''}per vessel · every module included
            </div>

            <hr className="ck-hr" />

            <div className="ck-caps">What’s included</div>
            <ul className="ck-inc">
              {INCLUDED.map((f) => <li key={f}><Tick />{f}</li>)}
              <li><Tick />{tier.support}</li>
            </ul>
          </div>

          {/* ── Billed to + Terms + pay ── */}
          <div className="ck-card">
            <TermsAcceptance
              value={terms}
              onChange={(patch) => setTerms((t) => ({ ...t, ...patch }))}
              disabled={submitting}
            />

            {error && <div className="ck-error">{error}</div>}

            <button type="button" className="ck-pay" onClick={handleSubmit} disabled={submitting || !ready}>
              {submitting ? 'Redirecting to Stripe…' : `Start subscription · £${price.toLocaleString('en-GB')}${priceSuffix}`}
            </button>
            <p className="ck-secure">
              {ready
                ? 'Secure checkout powered by Stripe. Renews automatically · cancel anytime from Cargo.'
                : 'Add the company the vessel is billed to and accept the Terms to continue.'}
            </p>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
};

export default CheckoutPage;

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';
import useScrollAnimations from '../../hooks/useScrollAnimations';

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

const PrimaryBtn = ({ onClick, disabled, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="mkt-archivo transition-colors duration-150"
    style={{
      fontWeight: 900,
      fontSize: 11,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: 'white',
      backgroundColor: disabled ? '#94A3B8' : '#1E3A5F',
      border: 'none',
      borderRadius: 50,
      padding: '14px 32px',
      cursor: disabled ? 'not-allowed' : 'pointer',
      width: '100%',
      marginTop: 8,
    }}
    onMouseEnter={(e) => {
      if (!disabled) e.currentTarget.style.backgroundColor = '#141D2E';
    }}
    onMouseLeave={(e) => {
      if (!disabled) e.currentTarget.style.backgroundColor = '#1E3A5F';
    }}
  >
    {children}
  </button>
);

const Check = () => (
  <span
    className="flex-shrink-0 flex items-center justify-center"
    style={{
      width: 20,
      height: 20,
      backgroundColor: '#F0F7FF',
      borderRadius: '50%',
      marginTop: 1,
    }}
  >
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <path
        d="M2 6l3 3 5-5"
        stroke="#4A90E2"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
        <section style={{ padding: '96px 32px', textAlign: 'center' }}>
          <p className="mkt-dmsans" style={{ color: '#64748B', marginBottom: 16 }}>
            We couldn't load your plan. Please start from the pricing page.
          </p>
          <Link
            to="/pricing"
            className="mkt-archivo"
            style={{
              color: '#1E3A5F',
              fontWeight: 700,
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            ← Back to Pricing
          </Link>
        </section>
      </MarketingLayout>
    );
  }

  const price = billingPeriod === 'annual' ? tier.annual : tier.monthly;
  const priceSuffix = billingPeriod === 'annual' ? '/year' : '/month';

  const handleSubmit = async () => {
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
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.url) {
        setError(
          data?.error ||
            'We couldn\u2019t start checkout. Please try again, or contact support if it keeps happening.'
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

  return (
    <MarketingLayout>
      <section style={{ paddingTop: 96, paddingBottom: 80 }}>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 24px' }}>
          <p
            className="mkt-archivo"
            style={{
              fontWeight: 600,
              fontSize: 9,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: '#4A90E2',
              marginBottom: 10,
            }}
          >
            Checkout
          </p>
          <h1
            className="mkt-archivo"
            style={{
              fontWeight: 900,
              fontSize: 32,
              textTransform: 'uppercase',
              color: '#1E3A5F',
              lineHeight: 1.05,
              marginBottom: 12,
            }}
          >
            Start your Cargo subscription
          </h1>
          <p
            className="mkt-dmsans"
            style={{
              fontWeight: 400,
              fontSize: 15,
              color: '#64748B',
              lineHeight: 1.7,
              marginBottom: 32,
            }}
          >
            Confirm your plan and billing period. You'll be redirected to Stripe to enter
            payment details, and we'll send you a magic link to set up your account the
            moment payment clears.
          </p>

          {cancelled && (
            <div
              style={{
                background: '#FFFBEB',
                border: '1px solid #FDE68A',
                borderRadius: 10,
                padding: '14px 18px',
                marginBottom: 24,
              }}
            >
              <p className="mkt-dmsans" style={{ fontSize: 13, color: '#92400E', lineHeight: 1.5 }}>
                You cancelled the Stripe checkout. No charge was made — when you're ready,
                confirm your plan below to try again.
              </p>
            </div>
          )}

          {/* ── Plan summary ── */}
          <div
            className="bg-white rounded-xl"
            style={{
              border: '2px solid #1E3A5F',
              padding: 28,
              marginBottom: 20,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 4,
                background: 'linear-gradient(90deg, #4A90E2, #1E3A5F)',
              }}
            />
            <p
              className="mkt-archivo"
              style={{
                fontWeight: 600,
                fontSize: 9,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                color: '#4A90E2',
                marginBottom: 6,
                marginTop: 8,
              }}
            >
              Your vessel
            </p>
            <p
              className="mkt-archivo"
              style={{ fontWeight: 900, fontSize: 22, color: '#1E3A5F', marginBottom: 2 }}
            >
              {verifiedVessel?.name || 'Your vessel'}
            </p>
            {verifiedVessel?.loa_metres && (
              <p
                className="mkt-dmsans"
                style={{ fontSize: 13, color: '#94A3B8', marginBottom: 20 }}
              >
                {verifiedVessel.loa_metres}m
                {verifiedVessel.type ? ` · ${verifiedVessel.type}` : ''}
                {verifiedVessel.flag ? ` · ${verifiedVessel.flag}` : ''}
              </p>
            )}

            <hr style={{ border: 'none', borderTop: '1px solid #E2E8F0', margin: '0 0 20px' }} />

            <p
              className="mkt-archivo"
              style={{
                fontWeight: 600,
                fontSize: 9,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                color: '#4A90E2',
                marginBottom: 6,
              }}
            >
              Your plan
            </p>
            <p
              className="mkt-archivo"
              style={{ fontWeight: 900, fontSize: 22, color: '#1E3A5F', marginBottom: 2 }}
            >
              {tier.label}
            </p>
            <p
              className="mkt-archivo"
              style={{ fontWeight: 900, fontSize: 40, color: '#1E3A5F', marginBottom: 2 }}
            >
              £{price}
              <span
                className="mkt-dmsans"
                style={{ fontSize: 16, fontWeight: 600, color: '#94A3B8' }}
              >
                {priceSuffix}
              </span>
            </p>
            <p className="mkt-dmsans" style={{ fontSize: 13, color: '#94A3B8', marginBottom: 20 }}>
              per vessel · every module included
            </p>

            {/* Billing toggle */}
            <div
              style={{
                display: 'flex',
                gap: 8,
                background: '#F0F7FF',
                padding: 4,
                borderRadius: 50,
                marginBottom: 20,
              }}
            >
              {['monthly', 'annual'].map((p) => (
                <button
                  key={p}
                  onClick={() => setBillingPeriod(p)}
                  className="mkt-archivo"
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    borderRadius: 50,
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: 900,
                    fontSize: 10,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: billingPeriod === p ? 'white' : '#1E3A5F',
                    backgroundColor: billingPeriod === p ? '#1E3A5F' : 'transparent',
                    transition: 'all 0.15s',
                  }}
                >
                  {p === 'monthly' ? 'Monthly' : 'Annual · 2 months free'}
                </button>
              ))}
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid #E2E8F0', margin: '0 0 20px' }} />

            <div style={{ textAlign: 'left' }}>
              {INCLUDED.map((f) => (
                <div
                  key={f}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    marginBottom: 10,
                  }}
                >
                  <Check />
                  <span
                    className="mkt-dmsans"
                    style={{ fontWeight: 400, fontSize: 13, color: '#475569', lineHeight: 1.5 }}
                  >
                    {f}
                  </span>
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 14 }}>
                <Check />
                <span
                  className="mkt-dmsans"
                  style={{ fontWeight: 400, fontSize: 13, color: '#475569', lineHeight: 1.5 }}
                >
                  {tier.support}
                </span>
              </div>
            </div>
          </div>

          {error && (
            <div
              style={{
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: 10,
                padding: '12px 16px',
                marginBottom: 12,
              }}
            >
              <p className="mkt-dmsans" style={{ fontSize: 13, color: '#DC2626', lineHeight: 1.5 }}>
                {error}
              </p>
            </div>
          )}

          <PrimaryBtn onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Redirecting to Stripe…' : `Start subscription · £${price}${priceSuffix}`}
          </PrimaryBtn>

          <p
            className="mkt-dmsans"
            style={{
              textAlign: 'center',
              fontSize: 12,
              color: '#94A3B8',
              marginTop: 14,
              lineHeight: 1.6,
            }}
          >
            Secure checkout powered by Stripe. Cancel anytime. You'll get a magic-link email
            to set up your account as soon as payment is confirmed.
          </p>

          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <Link
              to="/pricing"
              className="mkt-dmsans"
              style={{ fontSize: 13, color: '#94A3B8', textDecoration: 'none' }}
            >
              ← Back to pricing
            </Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
};

export default CheckoutPage;

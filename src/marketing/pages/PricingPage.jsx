import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';
import useScrollAnimations from '../../hooks/useScrollAnimations';

/* ─── Tier data ─────────────────────────────────────────────────────────── */
const TIERS = [
  {
    label: 'Under 40m',
    price: '179',
    description: 'Smaller yachts and lean programmes.',
    support: 'Self-serve onboarding with documentation. Email support.',
    highlight: false,
  },
  {
    label: '40 – 80m',
    price: '279',
    description: 'Charter vessels, busy private yachts, and growing programmes.',
    support: 'Guided onboarding session to set up your vessel structure, locations, and departments. Priority email support.',
    highlight: true,
  },
  {
    label: 'Over 80m',
    price: '399',
    description: 'Megayachts and complex operations with large crew.',
    support: 'Dedicated onboarding with data migration assistance. Priority support with direct access to the founder.',
    highlight: false,
  },
];

const FEATURES = [
  'Inventory management with full location structure',
  'Provisioning system with AI receipt scanning',
  'Guest preferences & trip management',
  'Crew management with role-based access',
  'Defects, jobs, laundry & accounts',
  'Dashboards, reporting & data export',
  'Unlimited crew accounts',
  'Real-time currency conversion',
];

/* ─── FAQ data ──────────────────────────────────────────────────────────── */
const PRICING_FAQ = [
  { q: 'Do all plans include every feature?', a: 'Yes. Every vessel gets full access to every module — inventory, provisioning, guest profiles, trips, crew management, AI document scanning, the lot. Cargo exists to replace multiple systems, and that only works if every vessel has the full picture.' },
  { q: 'How is pricing structured?', a: 'By vessel size (under 40m, 40–80m, over 80m). A larger vessel has more crew, more inventory, more provisioning. The product is the same — the scale is different.' },
  { q: 'Is there a trial?', a: "Yes. We offer a guided trial so you can see how Cargo works with your actual vessel setup before committing." },
  { q: 'Are there limits on crew accounts?', a: 'No. Every plan includes unlimited crew. No per-seat charges.' },
  { q: 'What about AI features?', a: "AI document scanning — receipts, delivery notes, inventory imports — is included on every plan. It's part of how Cargo works, not an add-on." },
];

const FAQItem = ({ q, a }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: '1px solid #E2E8F0' }}>
      <button
        className="w-full flex items-center justify-between gap-4 text-left"
        style={{ padding: '16px 0', background: 'none', border: 'none', cursor: 'pointer' }}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <span className="mkt-archivo" style={{ fontWeight: 900, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#1E3A5F', lineHeight: 1.4 }}>
          {q}
        </span>
        <span
          className="flex-shrink-0 flex items-center justify-center transition-transform duration-200"
          style={{
            width: 22, height: 22, border: '2px solid #1E3A5F', borderRadius: '50%',
            transform: open ? 'rotate(45deg)' : 'none',
            backgroundColor: open ? '#1E3A5F' : 'transparent',
          }}
        >
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path d="M4.5 1v7M1 4.5h7" stroke={open ? 'white' : '#1E3A5F'} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
      </button>
      {open && (
        <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 13, color: '#64748B', lineHeight: 1.7, paddingBottom: 16 }}>
          {a}
        </p>
      )}
    </div>
  );
};

/* ─── Check icon ────────────────────────────────────────────────────────── */
const Check = () => (
  <span
    className="flex-shrink-0 flex items-center justify-center"
    style={{ width: 20, height: 20, backgroundColor: '#F0F7FF', borderRadius: '50%', marginTop: 1 }}
  >
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <path d="M2 6l3 3 5-5" stroke="#4A90E2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </span>
);

/* ─── Page ──────────────────────────────────────────────────────────────── */
const PricingPage = () => {
  useScrollAnimations();
  return (
    <MarketingLayout>
      {/* Hero */}
      <section style={{ paddingTop: 96, paddingBottom: 56, borderBottom: '1px solid #E2E8F0', textAlign: 'center' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 32px' }}>
          <p data-animate-hero="fade-up" data-delay="0" className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#4A90E2', marginBottom: 10 }}>Pricing</p>
          <h1 data-animate-hero="fade-up" data-delay="0.12" className="mkt-archivo" style={{ fontWeight: 900, fontSize: 38, textTransform: 'uppercase', color: '#1E3A5F', lineHeight: 1.05, marginBottom: 14 }}>
            Every feature. Every vessel.
          </h1>
          <p data-animate-hero="fade-up" data-delay="0.24" className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 15, color: '#64748B', maxWidth: 480, margin: '0 auto', lineHeight: 1.7 }}>
            All modules included. Unlimited crew. No per-seat fees. No add-ons. Pricing reflects the size of your operation.
          </p>
        </div>
      </section>

      {/* Pricing cards */}
      <section style={{ padding: '72px 32px', borderBottom: '1px solid #E2E8F0' }}>
        <div data-animate="stagger" style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gap: 20 }} className="lg:grid-cols-3">
          {TIERS.map(({ label, price, description, support, highlight }) => (
            <div
              key={label}
              className="bg-white rounded-xl flex flex-col"
              style={{
                border: highlight ? '2px solid #1E3A5F' : '2px solid #E2E8F0',
                padding: 0,
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {highlight && (
                <div style={{ background: '#1E3A5F', padding: '6px 0', textAlign: 'center' }}>
                  <span className="mkt-archivo" style={{ fontWeight: 700, fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'white' }}>
                    Most popular
                  </span>
                </div>
              )}
              <div style={{ padding: 28, flex: 1, display: 'flex', flexDirection: 'column' }}>
                <p className="mkt-archivo" style={{ fontWeight: 900, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#4A90E2', marginBottom: 4 }}>
                  {label}
                </p>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
                  <span className="mkt-archivo" style={{ fontWeight: 900, fontSize: 40, color: '#1E3A5F' }}>£{price}</span>
                  <span className="mkt-dmsans" style={{ fontWeight: 500, fontSize: 14, color: '#94A3B8' }}>/month</span>
                </div>
                <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 13, color: '#64748B', lineHeight: 1.6, marginBottom: 20 }}>
                  {description}
                </p>

                <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: 16, marginBottom: 20, flex: 1 }}>
                  <p className="mkt-archivo" style={{ fontWeight: 700, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#94A3B8', marginBottom: 12 }}>
                    Everything included
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {FEATURES.map(f => (
                      <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <Check />
                        <span className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 12, color: '#475569', lineHeight: 1.5 }}>{f}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: 14, marginBottom: 20 }}>
                  <p className="mkt-archivo" style={{ fontWeight: 700, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#94A3B8', marginBottom: 6 }}>
                    Onboarding & support
                  </p>
                  <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 12, color: '#64748B', lineHeight: 1.6 }}>
                    {support}
                  </p>
                </div>

                <Link
                  to="/get-started"
                  className="mkt-archivo block text-center transition-colors duration-150"
                  style={{
                    fontWeight: 900, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
                    color: highlight ? 'white' : '#1E3A5F',
                    backgroundColor: highlight ? '#1E3A5F' : 'transparent',
                    border: '2px solid #1E3A5F',
                    borderRadius: 50, padding: '12px 22px', textDecoration: 'none',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.backgroundColor = highlight ? '#141D2E' : '#1E3A5F';
                    e.currentTarget.style.color = 'white';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.backgroundColor = highlight ? '#1E3A5F' : 'transparent';
                    e.currentTarget.style.color = highlight ? 'white' : '#1E3A5F';
                  }}
                >
                  Get Started
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Founding vessel banner */}
      <section style={{ padding: '48px 32px', borderBottom: '1px solid #E2E8F0' }}>
        <div data-animate="fade-up" style={{ maxWidth: 680, margin: '0 auto', background: '#FFFBF5', border: '2px solid #FDBA74', borderRadius: 14, padding: '24px 28px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <span style={{ fontSize: 22, flexShrink: 0, marginTop: 2 }}>🚢</span>
          <div>
            <p className="mkt-archivo" style={{ fontWeight: 900, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9A3412', marginBottom: 4 }}>
              Founding vessel rates
            </p>
            <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 13, color: '#78350F', lineHeight: 1.65 }}>
              Join during the build phase and this rate is locked in. Early operators also get direct input into the Cargo roadmap — the features you need get prioritised.
            </p>
          </div>
        </div>
      </section>

      {/* One-liner */}
      <section style={{ padding: '56px 32px', borderBottom: '1px solid #E2E8F0', textAlign: 'center', backgroundColor: 'white' }}>
        <div data-animate="fade-up" style={{ maxWidth: 620, margin: '0 auto' }}>
          <h2 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 22, color: '#1E3A5F', lineHeight: 1.2, marginBottom: 10 }}>
            Why every vessel gets every feature
          </h2>
          <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: '#64748B', lineHeight: 1.75 }}>
            Cargo exists to replace the four or five separate systems most vessels run on. If we gate provisioning or guest profiles behind a higher tier, a vessel on the lower plan is back to using spreadsheets alongside Cargo. That defeats the entire purpose. A larger vessel simply has more crew, more guests, more inventory, and more provisioning complexity — the pricing reflects that.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ padding: '72px 32px', borderBottom: '1px solid #E2E8F0' }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          <p data-animate="fade-up" className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#4A90E2', marginBottom: 10, textAlign: 'center' }}>Pricing FAQ</p>
          <h2 data-animate="fade-up" className="mkt-archivo" style={{ fontWeight: 900, fontSize: 22, color: '#1E3A5F', lineHeight: 1.15, marginBottom: 24, textAlign: 'center' }}>
            Common questions
          </h2>
          <div data-animate="stagger" data-stagger="0.1">
            {PRICING_FAQ.map(item => (
              <FAQItem key={item.q} {...item} />
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: '72px 32px' }}>
        <div data-animate="fade-up" className="text-center" style={{ maxWidth: 560, margin: '0 auto' }}>
          <p className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#4A90E2', marginBottom: 10 }}>Get started</p>
          <h2 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 26, color: '#1E3A5F', lineHeight: 1.15, marginBottom: 10 }}>Ready to come on board?</h2>
          <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: '#64748B', marginBottom: 28, lineHeight: 1.65 }}>
            Tell us about your vessel and we'll have you set up in no time.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link to="/get-started" className="mkt-archivo transition-colors duration-150"
              style={{ fontWeight: 900, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'white', backgroundColor: '#1E3A5F', borderRadius: 50, padding: '10px 22px', textDecoration: 'none' }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#141D2E')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#1E3A5F')}
            >Get Started</Link>
            <Link to="/contact" className="mkt-archivo transition-colors duration-150"
              style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#1E3A5F', border: '2px solid #1E3A5F', borderRadius: 50, padding: '8px 22px', textDecoration: 'none' }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#1E3A5F'; e.currentTarget.style.color = 'white'; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#1E3A5F'; }}
            >Book a Demo</Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
};

export default PricingPage;

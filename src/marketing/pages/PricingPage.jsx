import React, { useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';
import useScrollAnimations from '../../hooks/useScrollAnimations';
// Vessel verification via Netlify function (same-origin, no CORS issues)

/* ─── Constants ─────────────────────────────────────────────────────────── */

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

const PRICING_FAQ = [
  { q: 'Do all plans include every feature?', a: 'Yes. Every vessel gets full access to every module — inventory, provisioning, guest profiles, trips, crew management, AI document scanning, the lot. Cargo exists to replace multiple systems, and that only works if every vessel has the full picture.' },
  { q: 'How is pricing structured?', a: 'By vessel size (under 40m, 40–80m, over 80m). A larger vessel has more crew, more inventory, more provisioning. The product is the same — the scale is different.' },
  { q: 'Is there a trial?', a: "Yes. We offer a guided trial so you can see how Cargo works with your actual vessel setup before committing." },
  { q: 'Are there limits on crew accounts?', a: 'No. Every plan includes unlimited crew. No per-seat charges.' },
  { q: 'What about AI features?', a: "AI document scanning — receipts, delivery notes, inventory imports — is included on every plan. It's part of how Cargo works, not an add-on." },
];

const TIER_INFO = {
  under_40m: { label: 'Under 40m', price: '179', support: 'Self-serve onboarding with documentation. Email support.' },
  '40_80m': { label: '40 – 80m', price: '279', support: 'Guided onboarding session to set up your vessel structure, locations, and departments. Priority email support.' },
  over_80m: { label: 'Over 80m', price: '399', support: 'Dedicated onboarding with data migration assistance. Priority support with direct access to the founder.' },
};

function getPricingTier(loa) {
  if (loa < 40) return 'under_40m';
  if (loa <= 80) return '40_80m';
  return 'over_80m';
}

/* ─── Shared components ─────────────────────────────────────────────────── */

const Check = () => (
  <span className="flex-shrink-0 flex items-center justify-center" style={{ width: 20, height: 20, backgroundColor: '#F0F7FF', borderRadius: '50%', marginTop: 1 }}>
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#4A90E2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  </span>
);

const FAQItem = ({ q, a }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: '1px solid #E2E8F0' }}>
      <button className="w-full flex items-center justify-between gap-4 text-left" style={{ padding: '16px 0', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span className="mkt-archivo" style={{ fontWeight: 900, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#1E3A5F', lineHeight: 1.4 }}>{q}</span>
        <span className="flex-shrink-0 flex items-center justify-center transition-transform duration-200" style={{ width: 22, height: 22, border: '2px solid #1E3A5F', borderRadius: '50%', transform: open ? 'rotate(45deg)' : 'none', backgroundColor: open ? '#1E3A5F' : 'transparent' }}>
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M4.5 1v7M1 4.5h7" stroke={open ? 'white' : '#1E3A5F'} strokeWidth="1.5" strokeLinecap="round" /></svg>
        </span>
      </button>
      {open && <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 13, color: '#64748B', lineHeight: 1.7, paddingBottom: 16 }}>{a}</p>}
    </div>
  );
};

const ProgressBar = ({ current }) => (
  <div style={{ display: 'flex', gap: 8, marginBottom: 40, maxWidth: 520, margin: '0 auto 40px' }}>
    {[1, 2, 3, 4].map(i => (
      <div key={i} style={{ height: 4, flex: 1, borderRadius: 4, backgroundColor: i < current ? '#1E3A5F' : i === current ? '#4A90E2' : '#E2E8F0', transition: 'background-color 0.4s ease' }} />
    ))}
  </div>
);

const StepLabel = ({ n }) => (
  <p className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#4A90E2', marginBottom: 8 }}>Step {n} of 4</p>
);

const PrimaryBtn = ({ onClick, disabled, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="mkt-archivo transition-colors duration-150"
    style={{ fontWeight: 900, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'white', backgroundColor: disabled ? '#94A3B8' : '#1E3A5F', border: 'none', borderRadius: 50, padding: '14px 32px', cursor: disabled ? 'not-allowed' : 'pointer', width: '100%', marginTop: 8 }}
    onMouseEnter={e => { if (!disabled) e.currentTarget.style.backgroundColor = '#141D2E'; }}
    onMouseLeave={e => { if (!disabled) e.currentTarget.style.backgroundColor = '#1E3A5F'; }}
  >{children}</button>
);

const SecondaryBtn = ({ onClick, children }) => (
  <button
    onClick={onClick}
    className="mkt-archivo transition-colors duration-150"
    style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#1E3A5F', background: 'none', border: '2px solid #1E3A5F', borderRadius: 50, padding: '12px 32px', cursor: 'pointer', width: '100%', marginTop: 8 }}
    onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#1E3A5F'; e.currentTarget.style.color = 'white'; }}
    onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#1E3A5F'; }}
  >{children}</button>
);

const BackBtn = ({ onClick }) => (
  <button onClick={onClick} className="mkt-dmsans" style={{ fontSize: 13, color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer', marginTop: 16, width: '100%', textAlign: 'center' }}>Back</button>
);

const FieldLabel = ({ children }) => (
  <label className="mkt-archivo" style={{ display: 'block', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1E3A5F', marginBottom: 6 }}>{children}</label>
);

const inputStyle = { width: '100%', padding: '12px 16px', border: '2px solid #E2E8F0', borderRadius: 10, fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: '#1E3A5F', background: 'white', outline: 'none', transition: 'border-color 0.2s' };

const selectStyle = { ...inputStyle, appearance: 'none', backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%2394A3B8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 16px center', cursor: 'pointer' };

/* ─── Page ──────────────────────────────────────────────────────────────── */

const PricingPage = () => {
  useScrollAnimations();
  const navigate = useNavigate();

  const [step, setStep] = useState(1); // starts on vessel details
  const [vesselName, setVesselName] = useState('');
  const [imo, setImo] = useState('');
  const [noImo, setNoImo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifiedVessel, setVerifiedVessel] = useState(null);
  const [manualLoa, setManualLoa] = useState('');
  const [manualType, setManualType] = useState('');
  const [manualPort, setManualPort] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactRole, setContactRole] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [pricingTier, setPricingTier] = useState(null);
  const [usedManual, setUsedManual] = useState(false);
  const [verifyError, setVerifyError] = useState(null);
  const [existingTenantVessel, setExistingTenantVessel] = useState(null);
  // registrationId ties the lead row to the Stripe checkout session. It's
  // only populated on the verified-IMO path (verify-vessel persists the row
  // and returns the id) — manual-entry leads don't have one yet, so they
  // still fall back to the waitlist CTA on step 4.
  const [registrationId, setRegistrationId] = useState(null);

  // Step 1 submit — verify IMO or go to manual
  const handleStep1 = useCallback(async () => {
    if (!vesselName.trim()) return;
    setVerifyError(null);

    if (noImo) {
      setUsedManual(true);
      setStep(2.5); // manual entry
      return;
    }
    if (!imo.trim() || imo.trim().length !== 7) return;

    setLoading(true);
    setStep(1.5); // loading state

    try {
      const res = await fetch('/api/verify-vessel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imo: imo.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error('verify-vessel error:', data, 'debug:', data?.debug);
        setVerifyError(data?.error || 'Verification failed — check your IMO number or try again.');
        setLoading(false);
        setStep(1);
        return;
      }

      if (!data?.found) {
        setVerifyError('We couldn\u2019t find a vessel with that IMO number. Check the number or enter details manually.');
        setLoading(false);
        setStep(1);
        return;
      }

      // Existing-tenant short-circuit: this IMO already belongs to a live
      // Cargo tenant. Don't progress through pricing — push them to log in.
      if (data?.already_tenant) {
        setExistingTenantVessel(data.vessel);
        setLoading(false);
        setStep(1.75);
        return;
      }

      setVerifiedVessel(data.vessel);
      setPricingTier(data.pricing_tier);
      setRegistrationId(data.registration_id || null);
      setLoading(false);
      setStep(2);
    } catch (err) {
      console.error('verifyVessel exception:', err);
      setVerifyError('Something went wrong verifying your vessel. Please try again.');
      setLoading(false);
      setStep(1);
    }
  }, [vesselName, imo, noImo]);

  // Confirm verified vessel
  const handleConfirmVessel = () => {
    setStep(3);
  };

  // Submit manual entry
  const handleManualSubmit = () => {
    if (!manualLoa) return;
    const loa = parseFloat(manualLoa);
    setVerifiedVessel({
      name: vesselName.trim(),
      loa_metres: loa,
      type: manualType,
      flag: null,
      year_built: null,
    });
    setPricingTier(getPricingTier(loa));
    setStep(3);
  };

  // Submit contact details → show pricing
  const handleContactSubmit = () => {
    if (!contactName.trim() || !contactRole || !contactEmail.trim()) return;
    setStep(4);
  };

  // Final CTA — verified-IMO leads go to the Stripe checkout flow. Manual
  // entries (no registrationId yet) fall back to the waitlist "you're on the
  // list" screen exactly as before.
  const handleContinueToCheckout = () => {
    if (!registrationId) {
      setStep(5);
      return;
    }
    navigate('/checkout', {
      state: {
        vesselRegistrationId: registrationId,
        verifiedVessel,
        pricingTier,
        contact: {
          name: contactName.trim(),
          role: contactRole,
          email: contactEmail.trim(),
          phone: contactPhone.trim(),
        },
      },
    });
  };

  const handleJoinWaitlist = () => setStep(5);

  const tierInfo = pricingTier ? TIER_INFO[pricingTier] : null;

  return (
    <MarketingLayout>
      {/* ── Compact hero ── */}
      <section style={{ paddingTop: 80, paddingBottom: 40, textAlign: 'center' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 32px' }}>
          <p data-animate-hero="fade-up" data-delay="0" className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#4A90E2', marginBottom: 10 }}>Pricing</p>
          <h1 data-animate-hero="fade-up" data-delay="0.12" className="mkt-archivo" style={{ fontWeight: 900, fontSize: 38, textTransform: 'uppercase', color: '#1E3A5F', lineHeight: 1.05, marginBottom: 14 }}>
            Every feature. Every vessel.
          </h1>
          <p data-animate-hero="fade-up" data-delay="0.24" className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 15, color: '#64748B', maxWidth: 480, margin: '0 auto', lineHeight: 1.7 }}>
            All modules included. Unlimited crew. No per-seat fees. No add-ons.<br />Tell us about your vessel to see your plan.
          </p>
        </div>
      </section>

      {/* ── Questionnaire steps ── */}
      <section style={{ paddingTop: 24, paddingBottom: 80, minHeight: step < 5 ? '50vh' : 'auto' }}>
        <div style={{ maxWidth: 520, margin: '0 auto', padding: '0 24px' }}>
          {step < 5 && <ProgressBar current={step <= 2.5 ? 1 : step === 3 ? 3 : 4} />}

            {/* Step 1: Vessel details */}
            {step === 1 && (
              <div>
                <StepLabel n={1} />
                <h1 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 26, color: '#1E3A5F', lineHeight: 1.15, marginBottom: 8 }}>Tell us about your vessel</h1>
                <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: '#64748B', lineHeight: 1.6, marginBottom: 32 }}>We'll use this to verify your vessel and show you the right plan.</p>

                <div style={{ marginBottom: 20 }}>
                  <FieldLabel>Vessel Name</FieldLabel>
                  <input style={inputStyle} type="text" placeholder="e.g. Coral Ocean" value={vesselName} onChange={e => setVesselName(e.target.value)} onFocus={e => (e.target.style.borderColor = '#4A90E2')} onBlur={e => (e.target.style.borderColor = '#E2E8F0')} />
                </div>

                <div style={{ marginBottom: 8 }}>
                  <FieldLabel>IMO Number</FieldLabel>
                  <input style={{ ...inputStyle, opacity: noImo ? 0.5 : 1 }} type="text" placeholder="e.g. 1012345" maxLength={7} value={imo} onChange={e => setImo(e.target.value.replace(/\D/g, ''))} disabled={noImo} onFocus={e => (e.target.style.borderColor = '#4A90E2')} onBlur={e => (e.target.style.borderColor = '#E2E8F0')} />
                  <p className="mkt-dmsans" style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>7-digit number found on your vessel's registration documents</p>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 12 }}>
                  <input type="checkbox" checked={noImo} onChange={e => { setNoImo(e.target.checked); if (e.target.checked) { setImo(''); setVerifyError(null); } }} style={{ width: 18, height: 18, accentColor: '#1E3A5F' }} />
                  <span className="mkt-dmsans" style={{ fontSize: 13, color: '#64748B' }}>My vessel doesn't have an IMO number</span>
                </label>

                {verifyError && (
                  <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '12px 16px', marginBottom: 12 }}>
                    <p className="mkt-dmsans" style={{ fontSize: 13, color: '#DC2626', lineHeight: 1.5 }}>{verifyError}</p>
                    {!noImo && (
                      <button onClick={() => { setUsedManual(true); setVerifyError(null); setStep(2.5); }} className="mkt-dmsans" style={{ fontSize: 12, color: '#4A90E2', background: 'none', border: 'none', cursor: 'pointer', marginTop: 6, textDecoration: 'underline' }}>Enter details manually instead</button>
                    )}
                  </div>
                )}

                <PrimaryBtn onClick={handleStep1} disabled={!vesselName.trim() || (!noImo && imo.trim().length !== 7)}>Verify &amp; Continue</PrimaryBtn>
              </div>
            )}

            {/* Step 1.5: Loading */}
            {step === 1.5 && (
              <div style={{ textAlign: 'center', paddingTop: 48 }}>
                <StepLabel n={1} />
                <h1 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 26, color: '#1E3A5F', lineHeight: 1.15, marginBottom: 8 }}>Verifying your vessel</h1>
                <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: '#64748B', marginBottom: 32 }}>Checking vessel registry...</p>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-block', width: 20, height: 20, border: '3px solid #E2E8F0', borderTopColor: '#4A90E2', borderRadius: '50%', animation: 'cargo-spin 0.8s linear infinite' }} />
                  <span className="mkt-dmsans" style={{ fontSize: 14, color: '#64748B' }}>Looking up IMO <strong style={{ color: '#1E3A5F' }}>{imo}</strong></span>
                </div>
                <style>{`@keyframes cargo-spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            )}

            {/* Step 1.75: Already a tenant — short-circuit to login */}
            {step === 1.75 && existingTenantVessel && (
              <div>
                <StepLabel n={1} />
                <h1 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 26, color: '#1E3A5F', lineHeight: 1.15, marginBottom: 8 }}>This vessel is already on Cargo</h1>
                <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: '#64748B', lineHeight: 1.6, marginBottom: 24 }}>
                  It looks like <strong style={{ color: '#1E3A5F' }}>{existingTenantVessel.name}</strong> is already registered. Log in to continue, or get in touch if you think this is a mistake.
                </p>

                <div className="bg-white rounded-xl" style={{ border: '2px solid #1E3A5F', padding: 24, marginBottom: 24 }}>
                  <p className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#4A90E2', marginBottom: 12 }}>Existing Cargo vessel</p>
                  <p className="mkt-archivo" style={{ fontWeight: 900, fontSize: 20, color: '#1E3A5F', marginBottom: 4 }}>{existingTenantVessel.name}</p>
                  <p className="mkt-dmsans" style={{ fontSize: 13, color: '#64748B' }}>IMO {existingTenantVessel.imo}</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, paddingTop: 16, borderTop: '1px solid #E2E8F0' }}>
                    <span style={{ width: 24, height: 24, backgroundColor: '#ECFDF5', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </span>
                    <span className="mkt-dmsans" style={{ fontSize: 13, color: '#059669', fontWeight: 500 }}>Already a Cargo customer</span>
                  </div>
                </div>

                <PrimaryBtn onClick={() => navigate('/login-authentication')}>Log in to Cargo</PrimaryBtn>
                <SecondaryBtn
                  onClick={() =>
                    navigate(
                      `/contact?intent=support&vessel=${encodeURIComponent(existingTenantVessel.name || '')}`
                    )
                  }
                >
                  Contact support
                </SecondaryBtn>
                <BackBtn onClick={() => { setExistingTenantVessel(null); setStep(1); }} />
              </div>
            )}

            {/* Step 2: Vessel confirmation */}
            {step === 2 && verifiedVessel && (
              <div>
                <StepLabel n={1} />
                <h1 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 26, color: '#1E3A5F', lineHeight: 1.15, marginBottom: 8 }}>Is this your vessel?</h1>
                <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: '#64748B', marginBottom: 24 }}>We found this in the maritime registry.</p>

                <div className="bg-white rounded-xl" style={{ border: '2px solid #1E3A5F', padding: 24, marginBottom: 24 }}>
                  <p className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#4A90E2', marginBottom: 12 }}>Verified Vessel</p>
                  <p className="mkt-archivo" style={{ fontWeight: 900, fontSize: 20, color: '#1E3A5F', marginBottom: 16 }}>{verifiedVessel.name}</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <p className="mkt-archivo" style={{ fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>LOA</p>
                      <p className="mkt-dmsans" style={{ fontSize: 15, color: '#1E3A5F', fontWeight: 500, marginTop: 2 }}>{verifiedVessel.loa_metres}m</p>
                    </div>
                    <div>
                      <p className="mkt-archivo" style={{ fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Type</p>
                      <p className="mkt-dmsans" style={{ fontSize: 15, color: '#1E3A5F', fontWeight: 500, marginTop: 2 }}>{verifiedVessel.type || '—'}</p>
                    </div>
                    <div>
                      <p className="mkt-archivo" style={{ fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Flag</p>
                      <p className="mkt-dmsans" style={{ fontSize: 15, color: '#1E3A5F', fontWeight: 500, marginTop: 2 }}>{verifiedVessel.flag || '—'}</p>
                    </div>
                    <div>
                      <p className="mkt-archivo" style={{ fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Built</p>
                      <p className="mkt-dmsans" style={{ fontSize: 15, color: '#1E3A5F', fontWeight: 500, marginTop: 2 }}>{verifiedVessel.year_built || '—'}</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, paddingTop: 16, borderTop: '1px solid #E2E8F0' }}>
                    <span style={{ width: 24, height: 24, backgroundColor: '#ECFDF5', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </span>
                    <span className="mkt-dmsans" style={{ fontSize: 13, color: '#059669', fontWeight: 500 }}>Verified via maritime registry</span>
                  </div>
                </div>

                <PrimaryBtn onClick={handleConfirmVessel}>Yes, That's My Vessel</PrimaryBtn>
                <BackBtn onClick={() => setStep(1)} />
              </div>
            )}

            {/* Step 2.5: Manual entry */}
            {step === 2.5 && (
              <div>
                <StepLabel n={1} />
                <h1 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 26, color: '#1E3A5F', lineHeight: 1.15, marginBottom: 8 }}>Vessel details</h1>
                <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: '#64748B', marginBottom: 32 }}>No problem. Enter your vessel details and we'll verify during onboarding.</p>

                <div style={{ marginBottom: 20 }}>
                  <FieldLabel>Vessel Name</FieldLabel>
                  <input style={inputStyle} type="text" value={vesselName} onChange={e => setVesselName(e.target.value)} onFocus={e => (e.target.style.borderColor = '#4A90E2')} onBlur={e => (e.target.style.borderColor = '#E2E8F0')} />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <FieldLabel>Length Overall (metres)</FieldLabel>
                  <input style={inputStyle} type="number" placeholder="e.g. 52" value={manualLoa} onChange={e => setManualLoa(e.target.value)} onFocus={e => (e.target.style.borderColor = '#4A90E2')} onBlur={e => (e.target.style.borderColor = '#E2E8F0')} />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <FieldLabel>Vessel Type</FieldLabel>
                  <select style={selectStyle} value={manualType} onChange={e => setManualType(e.target.value)}>
                    <option value="" disabled>Select type</option>
                    <option>Motor Yacht</option>
                    <option>Sailing Yacht</option>
                    <option>Explorer</option>
                    <option>Catamaran</option>
                    <option>Other</option>
                  </select>
                </div>
                <div style={{ marginBottom: 20 }}>
                  <FieldLabel>Home Port (optional)</FieldLabel>
                  <input style={inputStyle} type="text" placeholder="e.g. Antibes" value={manualPort} onChange={e => setManualPort(e.target.value)} onFocus={e => (e.target.style.borderColor = '#4A90E2')} onBlur={e => (e.target.style.borderColor = '#E2E8F0')} />
                </div>

                <PrimaryBtn onClick={handleManualSubmit} disabled={!manualLoa || !vesselName.trim()}>Continue</PrimaryBtn>
                <BackBtn onClick={() => setStep(1)} />
              </div>
            )}

            {/* Step 3: Contact details */}
            {step === 3 && (
              <div>
                <StepLabel n={3} />
                <h1 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 26, color: '#1E3A5F', lineHeight: 1.15, marginBottom: 8 }}>Your details</h1>
                <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: '#64748B', marginBottom: 32 }}>So we know who to talk to about <strong style={{ color: '#1E3A5F' }}>{verifiedVessel?.name || vesselName}</strong>.</p>

                <div style={{ marginBottom: 20 }}>
                  <FieldLabel>Your Name</FieldLabel>
                  <input style={inputStyle} type="text" placeholder="e.g. Sarah Mitchell" value={contactName} onChange={e => setContactName(e.target.value)} onFocus={e => (e.target.style.borderColor = '#4A90E2')} onBlur={e => (e.target.style.borderColor = '#E2E8F0')} />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <FieldLabel>Your Role on Board</FieldLabel>
                  <select style={selectStyle} value={contactRole} onChange={e => setContactRole(e.target.value)}>
                    <option value="" disabled>Select role</option>
                    <option>Captain</option>
                    <option>Chief Officer</option>
                    <option>Purser</option>
                    <option>Chief Stewardess</option>
                    <option>Chief Engineer</option>
                    <option>Other</option>
                  </select>
                </div>
                <div style={{ marginBottom: 20 }}>
                  <FieldLabel>Email Address</FieldLabel>
                  <input style={inputStyle} type="email" placeholder="e.g. sarah@vessel.com" value={contactEmail} onChange={e => setContactEmail(e.target.value)} onFocus={e => (e.target.style.borderColor = '#4A90E2')} onBlur={e => (e.target.style.borderColor = '#E2E8F0')} />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <FieldLabel>Phone (optional)</FieldLabel>
                  <input style={inputStyle} type="tel" placeholder="e.g. +33 6 12 34 56 78" value={contactPhone} onChange={e => setContactPhone(e.target.value)} onFocus={e => (e.target.style.borderColor = '#4A90E2')} onBlur={e => (e.target.style.borderColor = '#E2E8F0')} />
                </div>

                <PrimaryBtn onClick={handleContactSubmit} disabled={!contactName.trim() || !contactRole || !contactEmail.trim()}>See My Plan</PrimaryBtn>
                <BackBtn onClick={() => setStep(usedManual ? 2.5 : 2)} />
              </div>
            )}

            {/* Step 4: Pricing reveal */}
            {step === 4 && tierInfo && (
              <div>
                <StepLabel n={4} />
                <h1 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 26, color: '#1E3A5F', lineHeight: 1.15, marginBottom: 8 }}>Your plan</h1>
                <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: '#64748B', marginBottom: 24 }}>
                  Based on <strong style={{ color: '#1E3A5F' }}>{verifiedVessel?.name || vesselName}</strong> ({verifiedVessel?.loa_metres}m), here's your plan.
                </p>

                <div className="bg-white rounded-xl" style={{ border: '2px solid #1E3A5F', padding: 32, textAlign: 'center', marginBottom: 20, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: 'linear-gradient(90deg, #4A90E2, #1E3A5F)' }} />
                  <p className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#4A90E2', marginBottom: 6, marginTop: 8 }}>Your plan</p>
                  <p className="mkt-archivo" style={{ fontWeight: 900, fontSize: 22, color: '#1E3A5F', marginBottom: 4 }}>{tierInfo.label}</p>
                  <p className="mkt-archivo" style={{ fontWeight: 900, fontSize: 40, color: '#1E3A5F', marginBottom: 2 }}>£{tierInfo.price}<span className="mkt-dmsans" style={{ fontSize: 16, fontWeight: 600, color: '#94A3B8' }}>/month</span></p>
                  <p className="mkt-dmsans" style={{ fontSize: 13, color: '#94A3B8', marginBottom: 16 }}>per vessel</p>
                  <div style={{ display: 'inline-block', background: '#ECFDF5', color: '#059669', fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '5px 14px', borderRadius: 20, marginBottom: 20 }}>Every feature included</div>
                  <hr style={{ border: 'none', borderTop: '1px solid #E2E8F0', margin: '0 0 20px' }} />
                  <div style={{ textAlign: 'left' }}>
                    {FEATURES.map(f => (
                      <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                        <Check />
                        <span className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 13, color: '#475569', lineHeight: 1.5 }}>{f}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                      <Check />
                      <span className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 13, color: '#475569', lineHeight: 1.5 }}>{tierInfo.support}</span>
                    </div>
                  </div>
                </div>

                {/* Founding vessel badge */}
                <div style={{ background: '#FFFBF5', border: '1px solid #FDBA74', borderRadius: 10, padding: '14px 18px', marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: 18 }}>🚢</span>
                  <div>
                    <p className="mkt-archivo" style={{ fontWeight: 700, fontSize: 12, color: '#9A3412', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Founding vessel rate</p>
                    <p className="mkt-dmsans" style={{ fontSize: 13, color: '#78350F', lineHeight: 1.5 }}>Join during the build phase and this rate is locked in. Early operators also get direct input into the roadmap.</p>
                  </div>
                </div>

                <PrimaryBtn onClick={handleContinueToCheckout}>
                  {registrationId ? 'Continue to checkout' : 'Book Your Demo'}
                </PrimaryBtn>
                <SecondaryBtn onClick={handleJoinWaitlist}>Join the Waitlist</SecondaryBtn>
              </div>
            )}

            {/* Step 5: Success */}
            {step === 5 && (
              <div style={{ textAlign: 'center', paddingTop: 48 }}>
                <div style={{ width: 64, height: 64, backgroundColor: '#ECFDF5', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none"><path d="M7 14l5 5 9-9" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
                <h1 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 26, color: '#1E3A5F', lineHeight: 1.15, marginBottom: 12 }}>You're on the list</h1>
                <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: '#64748B', lineHeight: 1.65, marginBottom: 32 }}>
                  We'll be in touch within 24 hours to book your demo and get <strong style={{ color: '#1E3A5F' }}>{verifiedVessel?.name || vesselName}</strong> set up on Cargo.
                </p>
                <Link to="/" className="mkt-archivo transition-colors duration-150" style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#1E3A5F', textDecoration: 'none' }}>← Back to Home</Link>
              </div>
            )}
          </div>
        </section>

      {/* ── Supporting content — always visible below questionnaire ── */}
      {step < 5 && (
        <>
          {/* What's included */}
          <section style={{ padding: '72px 32px', borderTop: '1px solid #E2E8F0', borderBottom: '1px solid #E2E8F0', backgroundColor: 'white' }}>
            <div data-animate="fade-up" style={{ maxWidth: 620, margin: '0 auto', textAlign: 'center' }}>
              <p className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#4A90E2', marginBottom: 10 }}>What's included</p>
              <h2 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 22, color: '#1E3A5F', lineHeight: 1.2, marginBottom: 24 }}>
                Every plan. Every feature.
              </h2>
              <div style={{ display: 'grid', gap: 10, textAlign: 'left', maxWidth: 400, margin: '0 auto' }} className="sm:grid-cols-1">
                {FEATURES.map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <Check />
                    <span className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 13, color: '#475569', lineHeight: 1.5 }}>{f}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Why vessel size */}
          <section style={{ padding: '56px 32px', borderBottom: '1px solid #E2E8F0', textAlign: 'center' }}>
            <div data-animate="fade-up" style={{ maxWidth: 620, margin: '0 auto' }}>
              <h2 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 22, color: '#1E3A5F', lineHeight: 1.2, marginBottom: 10 }}>
                Why every vessel gets every feature
              </h2>
              <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: '#64748B', lineHeight: 1.75 }}>
                Cargo exists to replace the four or five separate systems most vessels run on. If we gate provisioning or guest profiles behind a higher tier, a vessel on the lower plan is back to using spreadsheets alongside Cargo. That defeats the entire purpose. A larger vessel simply has more crew, more guests, more inventory, and more provisioning complexity — the pricing reflects that.
              </p>
            </div>
          </section>

          {/* Founding vessel */}
          <section style={{ padding: '48px 32px', borderBottom: '1px solid #E2E8F0' }}>
            <div data-animate="fade-up" style={{ maxWidth: 680, margin: '0 auto', background: '#FFFBF5', border: '2px solid #FDBA74', borderRadius: 14, padding: '24px 28px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <span style={{ fontSize: 22, flexShrink: 0, marginTop: 2 }}>🚢</span>
              <div>
                <p className="mkt-archivo" style={{ fontWeight: 900, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9A3412', marginBottom: 4 }}>Founding vessel rates</p>
                <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 13, color: '#78350F', lineHeight: 1.65 }}>
                  Join during the build phase and your rate is locked in. Early operators also get direct input into the Cargo roadmap — the features you need get prioritised.
                </p>
              </div>
            </div>
          </section>

          {/* FAQ */}
          <section style={{ padding: '72px 32px' }}>
            <div style={{ maxWidth: 680, margin: '0 auto' }}>
              <p data-animate="fade-up" className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#4A90E2', marginBottom: 10, textAlign: 'center' }}>Pricing FAQ</p>
              <h2 data-animate="fade-up" className="mkt-archivo" style={{ fontWeight: 900, fontSize: 22, color: '#1E3A5F', lineHeight: 1.15, marginBottom: 24, textAlign: 'center' }}>Common questions</h2>
              <div data-animate="stagger" data-stagger="0.1">
                {PRICING_FAQ.map(item => <FAQItem key={item.q} {...item} />)}
              </div>
            </div>
          </section>
        </>
      )}
    </MarketingLayout>
  );
};

export default PricingPage;

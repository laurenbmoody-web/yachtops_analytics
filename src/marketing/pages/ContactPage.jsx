import React, { useState, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';
import useScrollAnimations from '../../hooks/useScrollAnimations';

/* ─── Mode copy ──────────────────────────────────────────────────────────────
 * The contact page doubles as the landing place for existing Cargo customers
 * who hit the pricing questionnaire by mistake (e.g., their vessel already
 * has a tenant). For that flow, /pricing sends them here with
 *   ?intent=support&vessel={vessel_name}
 * and we swap in support-oriented copy so the page doesn't feel like a
 * pre-sales demo funnel.
 * ----------------------------------------------------------------------- */
const MODES = {
  demo: {
    eyebrow: 'Get in touch',
    title: "Let's talk about your vessel",
    subtitle:
      'Book a demo, join the waitlist, or just ask a question. We respond to every message personally.',
    formHeading: 'Send us a message',
    submitLabel: 'Submit Request',
    footnote: "No commitment required. We'll reach out within 24 hours.",
    confirmationTitle: 'Request received',
    confirmationBody:
      'Someone from the team will be in touch within 24 hours to confirm your demo.',
    defaultIntent: 'demo',
    steps: [
      { n: '01', title: 'We review your submission', body: "We'll take a look at your vessel type and team size to make sure Cargo is a good fit." },
      { n: '02', title: 'We reach out within 24 hours', body: 'A real person will contact you to confirm the demo or answer any pre-demo questions.' },
      { n: '03', title: '30-minute demo call', body: "We'll walk through Cargo with your specific operation in mind — no generic slides." },
    ],
    quickAnswers: [
      { q: 'Response time', a: 'Within 24 hours on weekdays' },
      { q: 'Demo length', a: '30 minutes, no commitment' },
      { q: 'Pricing', a: 'Per vessel, all modules included' },
    ],
  },
  support: {
    eyebrow: 'Cargo support',
    title: 'We’re here to help',
    subtitle:
      "Already a Cargo customer and need a hand? Tell us what's going on and the team will be straight back to you.",
    formHeading: 'Send us a support request',
    submitLabel: 'Send Support Request',
    footnote: "We'll come back to you as soon as we can — usually within a few hours on weekdays.",
    confirmationTitle: 'Support request received',
    confirmationBody:
      "Thanks — the team will be in touch shortly. If this is urgent and affects live operations, reply to the confirmation email and we'll escalate.",
    defaultIntent: 'support',
    steps: [
      { n: '01', title: 'We triage your request', body: "We'll look at what's going on and who on the team is best placed to help." },
      { n: '02', title: 'We come back to you fast', body: 'Most support requests are answered the same working day — urgent issues much sooner.' },
      { n: '03', title: 'We follow through', body: 'If it needs a fix or a change on our side, we stay on it until you tell us you’re sorted.' },
    ],
    quickAnswers: [
      { q: 'Urgent issues', a: 'Reply marked URGENT' },
      { q: 'Response time', a: 'Usually within a few hours' },
      { q: 'Account changes', a: 'Via your captain or owner rep' },
    ],
  },
};

/* ─── Form primitives ────────────────────────────────────────────────────── */
const Field = ({ label, id, type = 'text', placeholder, required, value, onChange }) => (
  <div>
    <label htmlFor={id} className="mkt-archivo block" style={{ fontWeight: 700, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1E3A5F', marginBottom: 6 }}>
      {label}{required && <span style={{ color: '#4A90E2', marginLeft: 2 }}>*</span>}
    </label>
    <input
      id={id} type={type} placeholder={placeholder} required={required}
      value={value} onChange={onChange}
      className="mkt-dmsans w-full transition-colors duration-150"
      style={{
        fontWeight: 400, fontSize: 14, color: '#1E3A5F',
        backgroundColor: 'white', border: '2px solid #E2E8F0',
        borderRadius: 8, padding: '10px 14px', outline: 'none',
      }}
      onFocus={e => (e.currentTarget.style.borderColor = '#1E3A5F')}
      onBlur={e => (e.currentTarget.style.borderColor = '#E2E8F0')}
    />
  </div>
);

const SelectField = ({ label, id, required, value, onChange, children }) => (
  <div>
    <label htmlFor={id} className="mkt-archivo block" style={{ fontWeight: 700, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1E3A5F', marginBottom: 6 }}>
      {label}{required && <span style={{ color: '#4A90E2', marginLeft: 2 }}>*</span>}
    </label>
    <select
      id={id} required={required} value={value} onChange={onChange}
      className="mkt-dmsans w-full transition-colors duration-150"
      style={{
        fontWeight: 400, fontSize: 14, color: '#1E3A5F',
        backgroundColor: 'white', border: '2px solid #E2E8F0',
        borderRadius: 8, padding: '10px 14px', outline: 'none', appearance: 'none',
      }}
      onFocus={e => (e.currentTarget.style.borderColor = '#1E3A5F')}
      onBlur={e => (e.currentTarget.style.borderColor = '#E2E8F0')}
    >
      {children}
    </select>
  </div>
);

/* ─── Form ───────────────────────────────────────────────────────────────── */
const ContactForm = ({ mode, prefillVessel }) => {
  const modeCopy = MODES[mode] || MODES.demo;
  const [form, setForm] = useState({
    name: '',
    email: '',
    vessel: prefillVessel || '',
    role: '',
    intent: modeCopy.defaultIntent,
    message: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }));

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center text-center" style={{ padding: '48px 0' }}>
        <div
          className="flex items-center justify-center"
          style={{ width: 52, height: 52, borderRadius: '50%', backgroundColor: 'rgba(74,144,226,0.1)', border: '2px solid #4A90E2', marginBottom: 16 }}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M4 11l4.5 4.5L18 6" stroke="#4A90E2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h3 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 16, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1E3A5F', marginBottom: 8 }}>
          {modeCopy.confirmationTitle}
        </h3>
        <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 13, color: '#64748B', maxWidth: 320 }}>
          {modeCopy.confirmationBody}
        </p>
      </div>
    );
  }

  const isSupport = mode === 'support';
  const vesselRequired = isSupport;
  const messagePlaceholder = isSupport
    ? "What's going wrong? The more detail you can share — when it started, which part of Cargo, any error messages — the faster we can help."
    : 'Tell us about your vessel, crew size, current pain points…';

  return (
    <form onSubmit={e => { e.preventDefault(); setSubmitted(true); }} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Your name" id="name" placeholder="e.g. Jamie Hartley" required value={form.name} onChange={set('name')} />
        <Field label="Email address" id="email" type="email" placeholder="you@vessel.com" required value={form.email} onChange={set('email')} />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field
          label="Vessel name"
          id="vessel"
          placeholder="e.g. M/Y Serenity"
          required={vesselRequired}
          value={form.vessel}
          onChange={set('vessel')}
        />
        <SelectField label="Your role" id="role" value={form.role} onChange={set('role')}>
          <option value="" disabled>Select your role…</option>
          <option value="captain">Captain</option>
          <option value="chief-stew">Chief Stewardess</option>
          <option value="chief-eng">Chief Engineer</option>
          <option value="bosun">Bosun</option>
          <option value="purser">Purser / Manager</option>
          <option value="owner">Owner / Owner Rep</option>
          <option value="other">Other</option>
        </SelectField>
      </div>
      <SelectField label="What brings you here?" id="intent" value={form.intent} onChange={set('intent')}>
        {isSupport ? (
          <>
            <option value="support">Existing customer support</option>
            <option value="bug">Something is broken</option>
            <option value="account">Account or billing question</option>
            <option value="feature">Feature request</option>
            <option value="other">Something else</option>
          </>
        ) : (
          <>
            <option value="demo">Book a demo</option>
            <option value="waitlist">Join the waitlist</option>
            <option value="question">Ask a question</option>
            <option value="pricing">Pricing enquiry</option>
          </>
        )}
      </SelectField>
      <div>
        <label htmlFor="message" className="mkt-archivo block" style={{ fontWeight: 700, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1E3A5F', marginBottom: 6 }}>
          {isSupport ? 'What do you need help with?' : 'Anything else'}
        </label>
        <textarea
          id="message" rows={5}
          placeholder={messagePlaceholder}
          value={form.message} onChange={set('message')}
          required={isSupport}
          className="mkt-dmsans w-full transition-colors duration-150"
          style={{
            fontWeight: 400, fontSize: 14, color: '#1E3A5F',
            backgroundColor: 'white', border: '2px solid #E2E8F0',
            borderRadius: 8, padding: '10px 14px', outline: 'none', resize: 'none',
          }}
          onFocus={e => (e.currentTarget.style.borderColor = '#1E3A5F')}
          onBlur={e => (e.currentTarget.style.borderColor = '#E2E8F0')}
        />
      </div>
      <button
        type="submit"
        className="mkt-archivo w-full transition-colors duration-150"
        style={{
          fontWeight: 900, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
          color: 'white', backgroundColor: '#1E3A5F', borderRadius: 50,
          padding: '12px 24px', border: 'none', cursor: 'pointer',
        }}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#141D2E')}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#1E3A5F')}
      >
        {modeCopy.submitLabel}
      </button>
      <p className="mkt-dmsans text-center" style={{ fontWeight: 400, fontSize: 11, color: '#94A3B8' }}>
        {modeCopy.footnote}
      </p>
    </form>
  );
};

/* ─── Page ───────────────────────────────────────────────────────────────── */
const ContactPage = () => {
  useScrollAnimations();
  const { search } = useLocation();

  // Parse the ?intent= and ?vessel= query params so the page can swap
  // between demo (default) and support (existing customer) modes. We
  // whitelist the mode so only known values win — any other intent value
  // falls through to the demo copy.
  const { mode, prefillVessel } = useMemo(() => {
    const params = new URLSearchParams(search);
    const rawIntent = (params.get('intent') || '').toLowerCase();
    const rawVessel = params.get('vessel') || '';
    return {
      mode: rawIntent === 'support' ? 'support' : 'demo',
      prefillVessel: rawVessel,
    };
  }, [search]);

  const modeCopy = MODES[mode];

  return (
    <MarketingLayout>
    {/* Hero */}
    <section style={{ paddingTop: 96, paddingBottom: 56, borderBottom: '1px solid #E2E8F0', textAlign: 'center' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 32px' }}>
        <p data-animate-hero="fade-up" data-delay="0" className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#4A90E2', marginBottom: 10 }}>{modeCopy.eyebrow}</p>
        <h1 data-animate-hero="fade-up" data-delay="0.12" className="mkt-archivo" style={{ fontWeight: 900, fontSize: 38, textTransform: 'uppercase', color: '#1E3A5F', lineHeight: 1.05, marginBottom: 14 }}>
          {modeCopy.title}
        </h1>
        <p data-animate-hero="fade-up" data-delay="0.24" className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 15, color: '#64748B', maxWidth: 520, margin: '0 auto', lineHeight: 1.7 }}>
          {modeCopy.subtitle}
        </p>
      </div>
    </section>

    {/* Main */}
    <section style={{ padding: '72px 32px 80px' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gap: 40 }} className="grid lg:grid-cols-5">

        {/* Form */}
        <div data-animate="fade-up" className="lg:col-span-3 bg-white rounded-xl p-8" style={{ border: '2px solid #1E3A5F' }}>
          <h2 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1E3A5F', marginBottom: 24 }}>
            {modeCopy.formHeading}
          </h2>
          <ContactForm mode={mode} prefillVessel={prefillVessel} />
        </div>

        {/* Sidebar */}
        <div data-animate="fade-up" data-delay="0.12" className="lg:col-span-2" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <div>
            <h3 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#1E3A5F', marginBottom: 20 }}>
              What happens next
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {modeCopy.steps.map(({ n, title, body }) => (
                <div key={n} className="flex gap-4">
                  <div
                    className="flex-shrink-0 flex items-center justify-center mkt-archivo"
                    style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid #1E3A5F', fontWeight: 900, fontSize: 10, color: '#1E3A5F' }}
                  >
                    {n}
                  </div>
                  <div>
                    <p className="mkt-archivo" style={{ fontWeight: 900, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#1E3A5F', marginBottom: 3 }}>{title}</p>
                    <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 12, color: '#64748B', lineHeight: 1.6 }}>{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: 24 }}>
            <h3 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.14em', color: '#94A3B8', marginBottom: 14 }}>
              Quick answers
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {modeCopy.quickAnswers.map(({ q, a }) => (
                <div key={q} className="flex justify-between items-baseline">
                  <span className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 12, color: '#94A3B8' }}>{q}</span>
                  <span className="mkt-dmsans" style={{ fontWeight: 500, fontSize: 12, color: '#64748B' }}>{a}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
    </MarketingLayout>
  );
};

export default ContactPage;

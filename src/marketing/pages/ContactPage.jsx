import React, { useState } from 'react';
import MarketingLayout from '../MarketingLayout';

/* ─── Form field ─────────────────────────────────────────────────────────── */
const Field = ({ label, id, type = 'text', placeholder, required, value, onChange }) => (
  <div>
    <label htmlFor={id} className="block text-sm font-medium text-white/60 mb-2">
      {label}{required && <span className="text-[#00A8CC] ml-0.5">*</span>}
    </label>
    <input
      id={id}
      type={type}
      placeholder={placeholder}
      required={required}
      value={value}
      onChange={onChange}
      className="w-full bg-white/[0.04] border border-white/[0.10] hover:border-white/[0.18] focus:border-[#00A8CC]/50 focus:outline-none focus:ring-1 focus:ring-[#00A8CC]/30 text-white placeholder-white/25 text-sm rounded-xl px-4 py-3 transition-colors duration-200"
    />
  </div>
);

const SelectField = ({ label, id, required, value, onChange, children }) => (
  <div>
    <label htmlFor={id} className="block text-sm font-medium text-white/60 mb-2">
      {label}{required && <span className="text-[#00A8CC] ml-0.5">*</span>}
    </label>
    <select
      id={id}
      required={required}
      value={value}
      onChange={onChange}
      className="w-full bg-[#0E1726] border border-white/[0.10] hover:border-white/[0.18] focus:border-[#00A8CC]/50 focus:outline-none focus:ring-1 focus:ring-[#00A8CC]/30 text-white text-sm rounded-xl px-4 py-3 transition-colors duration-200 appearance-none"
    >
      {children}
    </select>
  </div>
);

/* ─── What happens next ──────────────────────────────────────────────────── */
const steps = [
  { n: '1', title: 'We review your submission', body: 'We\'ll take a look at your vessel type and team size to make sure Cargo is a good fit.' },
  { n: '2', title: 'We reach out within 24 hours', body: 'A real person will contact you to confirm the demo or answer any pre-demo questions.' },
  { n: '3', title: '30-minute demo call', body: 'We\'ll walk through Cargo with your specific operation in mind — no generic slides.' },
];

/* ─── Form ───────────────────────────────────────────────────────────────── */
const ContactForm = () => {
  const [form, setForm] = useState({
    name: '', email: '', vessel: '', role: '', intent: 'demo', message: '',
  });
  const [submitted, setSubmitted] = useState(false);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    // Placeholder — wire to backend in a future phase
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-14 h-14 rounded-full bg-[#00A8CC]/15 flex items-center justify-center mb-5">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 12l4.5 4.5L19 7" stroke="#00A8CC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h3 className="font-heading font-bold text-xl text-white mb-2">We've received your request</h3>
        <p className="text-white/45 text-sm max-w-xs">
          Someone from the team will be in touch within 24 hours to confirm your demo.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid sm:grid-cols-2 gap-5">
        <Field
          label="Your name" id="name" placeholder="e.g. Jamie Hartley"
          required value={form.name} onChange={set('name')}
        />
        <Field
          label="Email address" id="email" type="email" placeholder="you@vessel.com"
          required value={form.email} onChange={set('email')}
        />
      </div>
      <div className="grid sm:grid-cols-2 gap-5">
        <Field
          label="Vessel name" id="vessel" placeholder="e.g. M/Y Serenity"
          value={form.vessel} onChange={set('vessel')}
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
        <option value="demo">Book a demo</option>
        <option value="waitlist">Join the waitlist</option>
        <option value="question">Ask a question</option>
        <option value="pricing">Pricing enquiry</option>
      </SelectField>
      <div>
        <label htmlFor="message" className="block text-sm font-medium text-white/60 mb-2">
          Anything else you'd like us to know
        </label>
        <textarea
          id="message"
          rows={4}
          placeholder="Tell us about your vessel, crew size, current pain points…"
          value={form.message}
          onChange={set('message')}
          className="w-full bg-white/[0.04] border border-white/[0.10] hover:border-white/[0.18] focus:border-[#00A8CC]/50 focus:outline-none focus:ring-1 focus:ring-[#00A8CC]/30 text-white placeholder-white/25 text-sm rounded-xl px-4 py-3 transition-colors duration-200 resize-none"
        />
      </div>
      <button
        type="submit"
        className="w-full flex items-center justify-center gap-2 bg-[#00A8CC] hover:bg-[#0094B3] text-white font-semibold text-base py-3.5 rounded-xl transition-colors duration-200 shadow-lg shadow-[#00A8CC]/20"
      >
        Submit Request
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <p className="text-center text-xs text-white/25">
        No commitment required. We'll reach out within 24 hours.
      </p>
    </form>
  );
};

/* ─── Page ───────────────────────────────────────────────────────────────── */
const ContactPage = () => (
  <MarketingLayout>
    {/* Hero */}
    <section className="relative pt-32 pb-16 sm:pt-40 sm:pb-20 px-6 text-center overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-[#00A8CC]/[0.06] blur-[100px] rounded-full pointer-events-none" />
      <div className="relative max-w-2xl mx-auto">
        <p className="text-[#00A8CC] text-xs font-semibold uppercase tracking-widest mb-5">Get in touch</p>
        <h1 className="font-heading text-4xl sm:text-5xl font-bold text-white leading-[1.08] tracking-tight mb-5">
          Let's talk about your vessel
        </h1>
        <p className="text-lg text-white/50 leading-relaxed">
          Book a demo, join the waitlist, or just ask a question.
          We respond to every message personally.
        </p>
      </div>
    </section>

    {/* Main content */}
    <section className="pb-24 px-6">
      <div className="max-w-5xl mx-auto grid lg:grid-cols-5 gap-12">

        {/* Form */}
        <div className="lg:col-span-3 bg-[#141D2E] border border-white/[0.07] rounded-2xl p-8">
          <h2 className="font-heading font-semibold text-lg text-white mb-6">Send us a message</h2>
          <ContactForm />
        </div>

        {/* What happens next */}
        <div className="lg:col-span-2 space-y-6">
          <div>
            <h3 className="font-heading font-semibold text-white text-base mb-5">What happens next</h3>
            <div className="space-y-5">
              {steps.map(({ n, title, body }) => (
                <div key={n} className="flex gap-4">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#00A8CC]/15 border border-[#00A8CC]/25 flex items-center justify-center">
                    <span className="text-[#00A8CC] text-xs font-bold">{n}</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white mb-0.5">{title}</p>
                    <p className="text-xs text-white/40 leading-relaxed">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-white/[0.06]" />

          {/* Quick answers */}
          <div>
            <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-4">Quick answers</p>
            <div className="space-y-3">
              {[
                { q: 'Response time', a: 'Within 24 hours on weekdays' },
                { q: 'Demo length', a: '30 minutes, no commitment' },
                { q: 'Pricing', a: 'Per vessel, all modules included' },
              ].map(({ q, a }) => (
                <div key={q} className="flex justify-between items-baseline">
                  <span className="text-xs text-white/40">{q}</span>
                  <span className="text-xs text-white/60 font-medium">{a}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  </MarketingLayout>
);

export default ContactPage;

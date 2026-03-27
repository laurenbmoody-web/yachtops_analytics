import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';
import useScrollAnimations from '../../hooks/useScrollAnimations';

/* ─── Accordion item ─────────────────────────────────────────────────────── */
const FAQItem = ({ q, a, index }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: '1px solid #E2E8F0' }}>
      <button
        className="w-full flex items-start justify-between gap-4 text-left"
        style={{ padding: '16px 0', background: 'none', border: 'none', cursor: 'pointer' }}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <div className="flex items-start gap-4">
          <span className="mkt-archivo flex-shrink-0" style={{ fontWeight: 900, fontSize: 11, color: '#4A90E2', marginTop: 2 }}>
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className="mkt-archivo" style={{ fontWeight: 900, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#1E3A5F', lineHeight: 1.4 }}>
            {q}
          </span>
        </div>
        <span
          className="flex-shrink-0 flex items-center justify-center transition-transform duration-200"
          style={{
            width: 22, height: 22, border: '2px solid #1E3A5F', borderRadius: '50%',
            transform: open ? 'rotate(45deg)' : 'none', marginTop: 2,
            backgroundColor: open ? '#1E3A5F' : 'transparent',
          }}
        >
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path d="M4.5 1v7M1 4.5h7" stroke={open ? 'white' : '#1E3A5F'} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
      </button>
      {open && (
        <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 13, color: '#64748B', lineHeight: 1.7, paddingBottom: 16, paddingLeft: 36 }}>
          {a}
        </p>
      )}
    </div>
  );
};

/* ─── FAQ data ───────────────────────────────────────────────────────────── */
const FAQ_GROUPS = [
  {
    heading: 'Getting started',
    items: [
      { q: "How long does it take to get set up?", a: "Most vessels are fully operational within a few days. The setup flow walks you through vessel configuration, crew onboarding, and inventory structure. We also offer a guided onboarding session for vessels with complex setups." },
      { q: "Can I import our existing inventory from a spreadsheet?", a: "Yes. Cargo's smart import engine accepts CSV files and automatically assigns categories and locations based on item names. You review and confirm the mapping before anything is committed." },
      { q: "What do I need to get started?", a: "Just your vessel details and crew email addresses. We'll walk you through the rest. No hardware, no IT setup, no on-site installation required." },
      { q: "Do you offer training?", a: "Yes. Every new account gets access to onboarding documentation and video walkthroughs. For larger vessels we offer live training sessions for department heads." },
    ],
  },
  {
    heading: 'Platform & access',
    items: [
      { q: "How does role-based access work?", a: "Cargo has three access tiers: COMMAND (full access, typically Captain/Purser), CHIEF (department head access with elevated permissions in their area), and standard CREW. You assign roles when inviting crew, and they can be updated at any time." },
      { q: "Can crew access Cargo on mobile?", a: "Yes. Cargo is fully responsive and works on phones and tablets. No app download required — it runs in the browser on any device." },
      { q: "What happens when crew rotate off?", a: "You can deactivate a crew member's account instantly. Their history remains in the system for auditing purposes, but they lose access immediately. New crew can be invited at any time." },
      { q: "Is data shared between vessels?", a: "No. Each vessel has its own isolated data environment. A crew member on two vessels can switch between them, but the data is never mixed." },
    ],
  },
  {
    heading: 'Features & modules',
    items: [
      { q: "Which modules are included?", a: "All modules are included: Inventory, Crew Management, Trips, Guest Profiles, Defect Tracking, Laundry, Ops Calendar, Duty Sets, Activity Feed, Vessel Blueprint, Locations, and Logs & Deliveries. There are no add-ons or tiers." },
      { q: "Can we customise the inventory category structure?", a: "Yes. You can define your own category taxonomy through the Inventory Category Settings, and the four-level location hierarchy can be named to match your vessel layout exactly." },
      { q: "Does Cargo integrate with other systems?", a: "We're building integrations on a needs-driven basis. If your vessel has a specific integration requirement, let us know — early operators have direct input into our roadmap." },
      { q: "Can we track defects through to maintenance records?", a: "Yes. Each defect has a full lifecycle from initial report through to close-out, with crew assignment, notes, and date history. Defects can be linked to vessel areas on the blueprint view." },
    ],
  },
  {
    heading: 'Pricing & plans',
    items: [
      { q: "How is Cargo priced?", a: "Pricing is per vessel and includes all modules and unlimited crew accounts. We offer an early-operator rate for vessels onboarding now. Contact us for current pricing." },
      { q: "Is there a free trial?", a: "Yes. We offer a guided trial for qualified vessels. Book a demo and we'll discuss whether a trial makes sense for your operation." },
      { q: "Are there limits on crew accounts or data storage?", a: "No. There are no per-seat charges and no data caps. Add as many crew as you need." },
    ],
  },
];

/* ─── Page ───────────────────────────────────────────────────────────────── */
const FAQPage = () => {
  useScrollAnimations();
  return (
    <MarketingLayout>
    {/* Hero */}
    <section style={{ paddingTop: 96, paddingBottom: 56, borderBottom: '1px solid #E2E8F0', textAlign: 'center' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 32px' }}>
        <p data-animate-hero="fade-up" data-delay="0" className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#4A90E2', marginBottom: 10 }}>FAQ</p>
        <h1 data-animate-hero="fade-up" data-delay="0.12" className="mkt-archivo" style={{ fontWeight: 900, fontSize: 38, textTransform: 'uppercase', color: '#1E3A5F', lineHeight: 1.05, marginBottom: 14 }}>
          Common questions
        </h1>
        <p data-animate-hero="fade-up" data-delay="0.24" className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 15, color: '#64748B', maxWidth: 440, margin: '0 auto', lineHeight: 1.7 }}>
          If you don't find what you need here, get in touch and we'll answer directly.
        </p>
      </div>
    </section>

    {/* FAQ groups */}
    <section style={{ padding: '72px 32px' }}>
      <div data-animate="stagger" data-stagger="0.15" style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 56 }}>
        {FAQ_GROUPS.map(({ heading, items }) => (
          <div key={heading}>
            <h2
              className="mkt-archivo"
              style={{ fontWeight: 900, fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#1E3A5F', marginBottom: 4, paddingBottom: 12, borderBottom: '2px solid #1E3A5F' }}
            >
              {heading}
            </h2>
            {items.map((item, i) => (
              <FAQItem key={item.q} {...item} index={i} />
            ))}
          </div>
        ))}
      </div>
    </section>

    {/* Still have questions */}
    <section style={{ padding: '0 32px 80px' }}>
      <div
        data-animate="fade-up"
        className="rounded-xl text-center"
        style={{ maxWidth: 560, margin: '0 auto', padding: '40px 32px', backgroundColor: 'white', border: '2px solid #1E3A5F' }}
      >
        <p className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#4A90E2', marginBottom: 10 }}>Still have questions?</p>
        <h2 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 22, color: '#1E3A5F', lineHeight: 1.15, marginBottom: 8 }}>We're happy to answer anything</h2>
        <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 13, color: '#64748B', marginBottom: 20 }}>Reach out directly and a real person will respond.</p>
        <Link to="/contact" className="mkt-archivo transition-colors duration-150"
          style={{ fontWeight: 900, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'white', backgroundColor: '#1E3A5F', borderRadius: 50, padding: '10px 22px', textDecoration: 'none', display: 'inline-block' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#141D2E')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#1E3A5F')}
        >Get in touch</Link>
      </div>
    </section>
    </MarketingLayout>
  );
};

export default FAQPage;

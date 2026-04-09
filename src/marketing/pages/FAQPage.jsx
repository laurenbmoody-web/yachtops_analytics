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
      { q: "How long before my crew can actually use it?", a: "Most vessels are up and running within a day. You set up your vessel profile, invite your crew, and start adding inventory. We offer a guided onboarding session to get your locations, departments, and categories set up properly from the start." },
      { q: "Can I bring across our existing inventory or do we start from scratch?", a: "Yes, you can import your existing inventory. Upload a spreadsheet or PDF of your current inventory and Cargo will map items to the right departments and locations. You review everything before it goes live — nothing gets committed without your sign-off." },
      { q: "Will my crew actually use it?", a: "That's the question, isn't it? Cargo is designed to be easier than the spreadsheet or WhatsApp thread it replaces. Crew see only what's relevant to their department and role — no clutter, less printing. If it's harder than what they're already doing, we've failed." },
      { q: "Do we need to install anything?", a: "No. Cargo runs in the browser on any device — phones, tablets, laptops. No app store download (just yet), no IT department, no special hardware." },
    ],
  },
  {
    heading: 'Using Cargo',
    items: [
      { q: "What happens when crew leave?", a: "When they're removed from the crew list they lose vessel-based access immediately (they will get to keep personal access and view things such as HOR and sea time). Everything they logged for the vessel — jobs completed, inventory changes, delivery receipts — stays as history and with the vessel so long as you hold an active membership. When new crew join, they walk into a full operational picture instead of starting from zero." },
      { q: "Can different departments see each other's stuff?", a: "By default, crew see their own department's work. Department heads (Chiefs) have broader access within their area, and Command-level users (Captain, Purser) can see everything. You control who sees what through role assignments." },
      { q: "Does it work on a slow marina Wi-Fi?", a: "Cargo is a lightweight web app, not a heavy desktop application. It works well on typical marina and 4G connections. We're conscious that connectivity at sea varies, and we design with that in mind." },
      { q: "Can I use Cargo for charter guest preferences?", a: "Yes — this is one of Cargo's strongest areas. Each guest has a detailed preference profile covering allergies, food and drink, service style, personality, and more. Preferences carry across trips, so returning guests don't have to re-explain themselves and your crew has the full picture before anyone boards." },
    ],
  },
  {
    heading: 'Provisioning & deliveries',
    items: [
      { q: "How does the provisioning system work?", a: "Create a board for each trip or event, add items by department, and track what's been ordered, received, and what's still outstanding. When deliveries arrive, you can scan the delivery note or receipt and Cargo matches items to your board automatically. Everything flows into a delivery history with cost tracking." },
      { q: "Can I photograph a receipt and have Cargo read it?", a: "Yes. Take a photo of a receipt or delivery note — even in a foreign language — and Cargo extracts the items, quantities, and prices using AI document scanning. It matches them to your provisioning board and logs them to delivery history." },
      { q: "What about returns and wrong deliveries?", a: "Cargo has a return slip workflow. Flag items, generate a return slip, and send it to the supplier by email directly from the system. The supplier gets a confirmation page." },
    ],
  },
  {
    heading: 'Account & data',
    items: [
      { q: "Is our guest and crew data secure?", a: "Each vessel's data is completely isolated — there's no cross-vessel access. Crew who leave lose access instantly. Access is controlled at the database level, not just the interface, so there's no way to accidentally see another vessel's information." },
      { q: "Can management companies see across multiple vessels?", a: "Fleet-level visibility is on the roadmap. Right now, each vessel operates independently. A crew member who works on multiple vessels can switch between them, but the data is always separate." },
      { q: "What if we want to cancel?", a: "Your data is yours. We'll export everything for you in a standard format. No lock-in, no penalties." },
    ],
  },
  {
    heading: 'Pricing',
    items: [
      { q: "How is pricing structured?", a: "Cargo is priced per vessel across three tiers depending on what you need. Every plan includes unlimited crew accounts — no per-seat charges. See the pricing page for details." },
      { q: "Is there a trial?", a: "Yes. We offer a guided trial so you can see how Cargo works with your actual vessel setup before committing." },
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

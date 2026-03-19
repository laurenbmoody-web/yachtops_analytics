import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';

/* ─── Accordion item ─────────────────────────────────────────────────────── */
const FAQItem = ({ q, a }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/[0.07]">
      <button
        className="w-full flex items-start justify-between gap-4 py-5 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="text-white font-medium text-base leading-snug">{q}</span>
        <span className={`flex-shrink-0 w-5 h-5 rounded-full border border-white/[0.15] flex items-center justify-center transition-transform duration-200 mt-0.5 ${open ? 'rotate-45' : ''}`}>
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true">
            <path d="M4.5 1v7M1 4.5h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </span>
      </button>
      {open && (
        <p className="pb-5 text-white/50 text-sm leading-relaxed pr-8">{a}</p>
      )}
    </div>
  );
};

/* ─── FAQ data ───────────────────────────────────────────────────────────── */
const faqGroups = [
  {
    heading: 'Getting started',
    items: [
      {
        q: 'How long does it take to get set up?',
        a: 'Most vessels are fully operational within a few days. The setup flow walks you through vessel configuration, crew onboarding, and inventory structure. We also offer a guided onboarding session for vessels with complex setups.',
      },
      {
        q: 'Can I import our existing inventory from a spreadsheet?',
        a: 'Yes. Cargo\'s smart import engine accepts CSV files and automatically assigns categories and locations based on item names. You review and confirm the mapping before anything is committed.',
      },
      {
        q: 'What do I need to get started?',
        a: 'Just your vessel details and crew email addresses. We\'ll walk you through the rest. No hardware, no IT setup, no on-site installation required.',
      },
      {
        q: 'Do you offer training?',
        a: 'Yes. Every new account gets access to onboarding documentation and video walkthroughs. For larger vessels we offer live training sessions for department heads.',
      },
    ],
  },
  {
    heading: 'Platform & access',
    items: [
      {
        q: 'How does role-based access work?',
        a: 'Cargo has three access tiers: COMMAND (full access, typically Captain/Purser), CHIEF (department head access with elevated permissions in their area), and standard CREW. You assign roles when inviting crew, and they can be updated at any time.',
      },
      {
        q: 'Can crew access Cargo on mobile?',
        a: 'Yes. Cargo is fully responsive and works on phones and tablets. No app download required — it runs in the browser on any device.',
      },
      {
        q: 'What happens when crew rotate off?',
        a: 'You can deactivate a crew member\'s account instantly. Their history remains in the system for auditing purposes, but they lose access immediately. New crew can be invited at any time.',
      },
      {
        q: 'Is data shared between vessels?',
        a: 'No. Each vessel has its own isolated data environment. A crew member on two vessels can switch between them, but the data is never mixed.',
      },
    ],
  },
  {
    heading: 'Features & modules',
    items: [
      {
        q: 'Which modules are included?',
        a: 'All modules are included: Inventory, Crew Management, Trips, Guest Profiles, Defect Tracking, Laundry, Ops Calendar, Duty Sets, Activity Feed, Vessel Blueprint, Locations, and Logs & Deliveries. There are no add-ons or tiers.',
      },
      {
        q: 'Can we customise the inventory category structure?',
        a: 'Yes. You can define your own category taxonomy through the Inventory Category Settings, and the four-level location hierarchy can be named to match your vessel layout exactly.',
      },
      {
        q: 'Does Cargo integrate with other systems?',
        a: 'We\'re building integrations on a needs-driven basis. If your vessel has a specific integration requirement, let us know — early operators have direct input into our roadmap.',
      },
      {
        q: 'Can we track defects through to maintenance records?',
        a: 'Yes. Each defect has a full lifecycle from initial report through to close-out, with crew assignment, notes, and date history. Defects can be linked to vessel areas on the blueprint view.',
      },
    ],
  },
  {
    heading: 'Pricing & plans',
    items: [
      {
        q: 'How is Cargo priced?',
        a: 'Pricing is per vessel and includes all modules and unlimited crew accounts. We offer an early-operator rate for vessels onboarding now. Contact us for current pricing.',
      },
      {
        q: 'Is there a free trial?',
        a: 'Yes. We offer a guided trial for qualified vessels. Book a demo and we\'ll discuss whether a trial makes sense for your operation.',
      },
      {
        q: 'Are there limits on crew accounts or data storage?',
        a: 'No. There are no per-seat charges and no data caps. Add as many crew as you need.',
      },
    ],
  },
];

/* ─── Page ───────────────────────────────────────────────────────────────── */
const FAQPage = () => (
  <MarketingLayout>
    {/* Hero */}
    <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-24 px-6 text-center overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-[#00A8CC]/[0.06] blur-[100px] rounded-full pointer-events-none" />
      <div className="relative max-w-2xl mx-auto">
        <p className="text-[#00A8CC] text-xs font-semibold uppercase tracking-widest mb-5">FAQ</p>
        <h1 className="font-heading text-4xl sm:text-5xl font-bold text-white leading-[1.08] tracking-tight mb-5">
          Common questions
        </h1>
        <p className="text-lg text-white/50 leading-relaxed">
          If you don't find what you need here, get in touch and we'll answer directly.
        </p>
      </div>
    </section>

    {/* FAQ groups */}
    <section className="pb-24 px-6">
      <div className="max-w-3xl mx-auto space-y-14">
        {faqGroups.map(({ heading, items }) => (
          <div key={heading}>
            <h2 className="font-heading font-semibold text-sm text-white/30 uppercase tracking-widest mb-2">
              {heading}
            </h2>
            <div>
              {items.map(({ q, a }) => (
                <FAQItem key={q} q={q} a={a} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>

    {/* Still have questions */}
    <section className="py-16 px-6 bg-[#060E1A]">
      <div className="max-w-xl mx-auto text-center">
        <h2 className="font-heading text-2xl font-bold text-white mb-3">Still have questions?</h2>
        <p className="text-white/45 mb-6">We're happy to answer anything — just reach out directly.</p>
        <Link
          to="/contact"
          className="inline-flex items-center gap-2 border border-white/[0.12] hover:border-white/[0.22] text-white/70 hover:text-white font-medium px-6 py-3 rounded-xl transition-colors duration-200"
        >
          Get in touch
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </div>
    </section>
  </MarketingLayout>
);

export default FAQPage;

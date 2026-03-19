import React from 'react';
import { Link } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';

/* ─── Shared ─────────────────────────────────────────────────────────────── */
const PageHero = ({ eyebrow, headline, sub }) => (
  <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-24 px-6 text-center overflow-hidden">
    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-[#00A8CC]/[0.06] blur-[100px] rounded-full pointer-events-none" />
    <div className="relative max-w-3xl mx-auto">
      {eyebrow && (
        <p className="text-[#00A8CC] text-xs font-semibold uppercase tracking-widest mb-5">{eyebrow}</p>
      )}
      <h1 className="font-heading text-4xl sm:text-5xl font-bold text-white leading-[1.08] tracking-tight mb-5">
        {headline}
      </h1>
      {sub && <p className="text-lg text-white/50 leading-relaxed max-w-2xl mx-auto">{sub}</p>}
    </div>
  </section>
);

const SectionHeading = ({ eyebrow, headline, sub, center = true }) => (
  <div className={`mb-12 ${center ? 'text-center' : ''}`}>
    {eyebrow && (
      <p className="text-[#00A8CC] text-xs font-semibold uppercase tracking-widest mb-4">{eyebrow}</p>
    )}
    <h2 className="font-heading text-3xl sm:text-4xl font-bold text-white mb-4">{headline}</h2>
    {sub && <p className="text-white/45 text-lg max-w-2xl mx-auto">{sub}</p>}
  </div>
);

const CTABanner = () => (
  <section className="py-24 px-6">
    <div className="max-w-3xl mx-auto">
      <div className="relative bg-gradient-to-br from-[#0F1E30] to-[#0B1220] border border-[#00A8CC]/20 rounded-3xl p-12 text-center overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 bg-[#00A8CC]/10 blur-3xl rounded-full" />
        <div className="relative">
          <h2 className="font-heading text-3xl font-bold text-white mb-4">
            Ready to see Cargo in action?
          </h2>
          <p className="text-white/45 text-lg mb-8">
            Book a 30-minute demo and we'll walk through it with your specific vessel in mind.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/contact"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-[#00A8CC] hover:bg-[#0094B3] text-white font-semibold px-7 py-3.5 rounded-xl transition-colors duration-200 shadow-lg shadow-[#00A8CC]/20"
            >
              Book a Demo
            </Link>
            <Link
              to="/features"
              className="w-full sm:w-auto inline-flex items-center justify-center border border-white/[0.12] hover:border-white/[0.22] text-white/60 hover:text-white font-medium px-7 py-3.5 rounded-xl transition-colors duration-200"
            >
              Explore Features
            </Link>
          </div>
        </div>
      </div>
    </div>
  </section>
);

/* ─── How it works ───────────────────────────────────────────────────────── */
const steps = [
  {
    n: '01',
    title: 'Set up your vessel',
    body: 'Add your vessel profile, define locations and storage areas, and configure your crew structure. Cargo maps to how your vessel is actually organised.',
  },
  {
    n: '02',
    title: 'Onboard your crew',
    body: 'Invite crew by role and email. Each person gets the access level they need — from full COMMAND access down to standard crew. Roles enforce what each person can see and do.',
  },
  {
    n: '03',
    title: 'Run everything from one place',
    body: 'Inventory, scheduling, trips, guests, defects — all accessible from the same system, all connected to the same vessel context. No switching apps, no copying data.',
  },
];

const HowItWorks = () => (
  <section className="py-24 px-6 bg-[#060E1A]">
    <div className="max-w-7xl mx-auto">
      <SectionHeading eyebrow="How it works" headline="Up and running in days, not months" sub="Cargo is built for vessels that operate now. No months-long implementation projects." />
      <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
        {steps.map(({ n, title, body }) => (
          <div key={n} className="relative">
            <div className="text-[56px] font-heading font-bold text-white/[0.04] leading-none mb-4 select-none">
              {n}
            </div>
            <h3 className="font-heading font-semibold text-lg text-white mb-3">{title}</h3>
            <p className="text-sm text-white/45 leading-relaxed">{body}</p>
            {n !== '03' && (
              <div className="hidden md:block absolute top-8 left-full w-8 border-t border-dashed border-white/10 -translate-y-1/2" />
            )}
          </div>
        ))}
      </div>
    </div>
  </section>
);

/* ─── Module overview ────────────────────────────────────────────────────── */
const modules = [
  {
    title: 'Inventory',
    body: 'Four-level location hierarchy, smart bulk import, analytics, and real-time item status across every storage area on the vessel.',
    color: 'text-[#00A8CC]',
    bg: 'bg-[#00A8CC]/10',
  },
  {
    title: 'Crew Management',
    body: 'Profiles, role assignments, onboarding flows, and individual skill/certification visibility for every person aboard.',
    color: 'text-violet-400',
    bg: 'bg-violet-400/10',
  },
  {
    title: 'Trips & Itineraries',
    body: 'Full charter and voyage lifecycle — from initial booking through itinerary planning, guest allocation, and post-trip history.',
    color: 'text-emerald-400',
    bg: 'bg-emerald-400/10',
  },
  {
    title: 'Guest Profiles',
    body: 'Comprehensive preference management for every guest. Dietary needs, cabin preferences, activities, allergies — synced to every trip they join.',
    color: 'text-amber-400',
    bg: 'bg-amber-400/10',
  },
  {
    title: 'Defect Tracking',
    body: 'Log, assign, and close out maintenance defects. Link them to vessel areas, crew members, and trip schedules.',
    color: 'text-red-400',
    bg: 'bg-red-400/10',
  },
  {
    title: 'Ops Calendar',
    body: 'A vessel-wide operational calendar that surfaces trips, duty rotations, crew leave, and maintenance windows in one view.',
    color: 'text-sky-400',
    bg: 'bg-sky-400/10',
  },
];

const ModuleOverview = () => (
  <section className="py-24 px-6">
    <div className="max-w-7xl mx-auto">
      <SectionHeading eyebrow="What's inside" headline="Six core modules. One coherent platform." sub="Each module is purpose-built but connected — data flows between them so you're never entering the same thing twice." />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {modules.map(({ title, body, color, bg }) => (
          <div key={title} className="bg-[#141D2E] border border-white/[0.07] hover:border-white/[0.12] rounded-2xl p-6 transition-colors duration-200">
            <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg ${bg} mb-4`}>
              <span className={`w-2 h-2 rounded-full ${color.replace('text-', 'bg-')}`} />
            </div>
            <h3 className={`font-heading font-semibold text-base mb-2 ${color}`}>{title}</h3>
            <p className="text-sm text-white/45 leading-relaxed">{body}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

/* ─── Why Cargo ──────────────────────────────────────────────────────────── */
const comparisons = [
  { label: 'Built for yacht ops', cargo: true, generic: false },
  { label: 'Role-based crew access', cargo: true, generic: false },
  { label: 'Location-first inventory', cargo: true, generic: false },
  { label: 'Guest preference management', cargo: true, generic: false },
  { label: 'Integrated trip & crew calendar', cargo: true, generic: false },
  { label: 'Voyage & defect history', cargo: true, generic: false },
  { label: 'Mobile-ready for crew', cargo: true, generic: true },
  { label: 'Cloud-hosted', cargo: true, generic: true },
];

const WhyCargo = () => (
  <section className="py-24 px-6 bg-[#060E1A]">
    <div className="max-w-3xl mx-auto">
      <SectionHeading eyebrow="Why Cargo" headline="Not adapted from hotel or fleet software" sub="Generic operations tools miss what makes yacht ops unique. Cargo was built for it." />
      <div className="bg-[#141D2E] border border-white/[0.07] rounded-2xl overflow-hidden">
        <div className="grid grid-cols-3 text-xs font-semibold text-white/30 uppercase tracking-wider px-6 py-4 border-b border-white/[0.06]">
          <span className="col-span-1">Capability</span>
          <span className="text-center">Cargo</span>
          <span className="text-center">Generic tools</span>
        </div>
        {comparisons.map(({ label, cargo, generic }, i) => (
          <div
            key={label}
            className={`grid grid-cols-3 items-center px-6 py-4 text-sm ${i !== comparisons.length - 1 ? 'border-b border-white/[0.04]' : ''}`}
          >
            <span className="text-white/55 col-span-1">{label}</span>
            <span className="flex justify-center">
              {cargo ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="8" cy="8" r="7" fill="#00A8CC" fillOpacity="0.15" />
                  <path d="M4.5 8l2.5 2.5L11.5 5" stroke="#00A8CC" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="8" cy="8" r="7" fill="#F87171" fillOpacity="0.1" />
                  <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#F87171" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              )}
            </span>
            <span className="flex justify-center">
              {generic ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="8" cy="8" r="7" fill="#00A8CC" fillOpacity="0.15" />
                  <path d="M4.5 8l2.5 2.5L11.5 5" stroke="#00A8CC" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="8" cy="8" r="7" fill="#F87171" fillOpacity="0.1" />
                  <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#F87171" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  </section>
);

/* ─── Page ───────────────────────────────────────────────────────────────── */
const ProductPage = () => (
  <MarketingLayout>
    <PageHero
      eyebrow="The product"
      headline="One platform. End-to-end vessel operations."
      sub="Cargo replaces the patchwork of spreadsheets, chat threads, and disconnected apps that most vessel teams rely on today."
    />
    <HowItWorks />
    <ModuleOverview />
    <WhyCargo />
    <CTABanner />
  </MarketingLayout>
);

export default ProductPage;

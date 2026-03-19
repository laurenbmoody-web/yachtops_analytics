import React from 'react';
import { Link } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';

/* ─── Decorative UI mockup ──────────────────────────────────────────────── */
const DashboardMockup = () => (
  <div className="relative w-full max-w-2xl mx-auto">
    {/* Glow behind */}
    <div className="absolute inset-0 translate-y-6 blur-3xl opacity-25 bg-gradient-to-br from-[#00A8CC] to-[#1E3A5F] rounded-3xl" />
    {/* Window chrome */}
    <div className="relative bg-[#0E1726] border border-white/[0.10] rounded-2xl overflow-hidden shadow-2xl">
      {/* Title bar */}
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-white/[0.07] bg-[#0B1220]">
        <span className="w-3 h-3 rounded-full bg-[#FF5F57]" />
        <span className="w-3 h-3 rounded-full bg-[#FEBC2E]" />
        <span className="w-3 h-3 rounded-full bg-[#28C840]" />
        <span className="ml-3 text-xs text-white/25 font-mono">Cargo — Dashboard</span>
      </div>
      {/* Sidebar + content layout */}
      <div className="flex h-[320px] sm:h-[380px]">
        {/* Sidebar */}
        <div className="hidden sm:flex flex-col gap-1 w-48 border-r border-white/[0.06] p-3 bg-[#0B1220]/60 flex-shrink-0">
          {[
            { label: 'Today', active: true },
            { label: 'Inventory' },
            { label: 'Crew' },
            { label: 'Trips' },
            { label: 'Guests' },
            { label: 'Defects' },
            { label: 'Laundry' },
          ].map(({ label, active }) => (
            <div
              key={label}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-xs ${
                active ? 'bg-[#00A8CC]/15 text-[#00A8CC]' : 'text-white/30'
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-[#00A8CC]' : 'bg-white/15'}`} />
              {label}
            </div>
          ))}
        </div>
        {/* Content pane */}
        <div className="flex-1 p-5 overflow-hidden">
          <p className="text-[10px] text-white/25 uppercase tracking-widest mb-4">Today — 19 Mar</p>
          {/* Stat cards */}
          <div className="grid grid-cols-3 gap-2.5 mb-5">
            {[
              { label: 'Open Tasks', value: '12' },
              { label: 'Crew On', value: '8' },
              { label: 'Defects', value: '3' },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white/[0.04] border border-white/[0.06] rounded-lg p-3">
                <p className="text-white/30 text-[9px] uppercase tracking-wide mb-1">{label}</p>
                <p className="text-white text-xl font-semibold font-heading">{value}</p>
              </div>
            ))}
          </div>
          {/* Recent activity rows */}
          <div className="space-y-2">
            {[
              { dot: 'bg-[#00A8CC]', text: 'Engine room inventory sync complete' },
              { dot: 'bg-amber-400', text: 'Defect #14 assigned to Chief Eng.' },
              { dot: 'bg-emerald-400', text: 'Trip "Monaco → Portofino" confirmed' },
              { dot: 'bg-white/20', text: 'Crew rotation updated for April' },
            ].map(({ dot, text }, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                <p className="text-white/35 text-[11px]">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  </div>
);

/* ─── Section: Hero ─────────────────────────────────────────────────────── */
const HeroSection = () => (
  <section className="relative pt-32 pb-24 sm:pt-40 sm:pb-32 px-6 overflow-hidden">
    {/* Background radial glow */}
    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-[#00A8CC]/[0.07] blur-[120px] rounded-full pointer-events-none" />

    <div className="relative max-w-7xl mx-auto">
      <div className="max-w-3xl mx-auto text-center mb-16">
        {/* Tag */}
        <div className="inline-flex items-center gap-2 bg-[#00A8CC]/10 border border-[#00A8CC]/20 text-[#00A8CC] text-xs font-semibold px-3.5 py-1.5 rounded-full mb-8 tracking-wide uppercase">
          <span className="w-1.5 h-1.5 rounded-full bg-[#00A8CC]" />
          Built for professional yacht operations
        </div>

        {/* Headline */}
        <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-[1.08] tracking-tight mb-6">
          The ops platform built for{' '}
          <span className="text-[#00A8CC]">real yacht crews</span>
        </h1>

        {/* Subhead */}
        <p className="text-lg sm:text-xl text-white/50 leading-relaxed max-w-2xl mx-auto mb-10">
          Cargo unifies inventory, crew scheduling, trips, guests, defects, and
          every operational detail in one system. No more spreadsheets. No more
          WhatsApp threads. Just your vessel, running.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/contact"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-[#00A8CC] hover:bg-[#0094B3] text-white font-semibold text-base px-7 py-3.5 rounded-xl transition-colors duration-200 shadow-lg shadow-[#00A8CC]/20"
          >
            Book a Demo
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <Link
            to="/features"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 border border-white/[0.12] hover:border-white/[0.22] text-white/70 hover:text-white font-medium text-base px-7 py-3.5 rounded-xl transition-colors duration-200"
          >
            Explore Features
          </Link>
        </div>
      </div>

      {/* Mockup */}
      <DashboardMockup />
    </div>
  </section>
);

/* ─── Section: Stat strip ───────────────────────────────────────────────── */
const stats = [
  { value: '10+', label: 'Operational modules' },
  { value: '100%', label: 'Crew visibility' },
  { value: '0', label: 'Spreadsheets needed' },
  { value: '1', label: 'Platform for everything' },
];

const StatsStrip = () => (
  <section className="border-y border-white/[0.06] bg-[#0B1220]/80">
    <div className="max-w-7xl mx-auto px-6 lg:px-8 py-10">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-4">
        {stats.map(({ value, label }) => (
          <div key={label} className="text-center">
            <p className="font-heading text-3xl sm:text-4xl font-bold text-[#00A8CC] mb-1">{value}</p>
            <p className="text-sm text-white/40">{label}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

/* ─── Section: Problem → Solution ───────────────────────────────────────── */
const problems = [
  'Inventory scattered across paper lists and spreadsheets',
  'Crew schedules lost in WhatsApp chats',
  'Guest preferences stored in the captain\'s notebook',
  'Maintenance defects tracked in email threads',
  'No single source of truth for anything',
];

const solutions = [
  'Real-time inventory at every location, searchable and auditable',
  'Crew scheduling and rotation with duty-set visibility',
  'Guest preference profiles synced to every trip',
  'Defect tracking from report to close-out',
  'One platform where the whole vessel runs',
];

const ProblemSolution = () => (
  <section className="py-24 px-6">
    <div className="max-w-7xl mx-auto">
      <div className="text-center mb-16">
        <h2 className="font-heading text-3xl sm:text-4xl font-bold text-white mb-4">
          Yachts are complex. Most software isn't built for them.
        </h2>
        <p className="text-white/45 text-lg max-w-2xl mx-auto">
          Cargo was designed from the ground up for the realities of running a
          professional vessel — not adapted from hotel or fleet software.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
        {/* Problems */}
        <div className="bg-[#141D2E] border border-white/[0.07] rounded-2xl p-8">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-7 h-7 rounded-lg bg-red-500/15 flex items-center justify-center flex-shrink-0">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                <path d="M2 2l9 9M11 2l-9 9" stroke="#F87171" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </div>
            <h3 className="font-semibold text-white">Without Cargo</h3>
          </div>
          <ul className="space-y-4">
            {problems.map((p) => (
              <li key={p} className="flex items-start gap-3 text-sm text-white/45">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-red-400/50 flex-shrink-0" />
                {p}
              </li>
            ))}
          </ul>
        </div>

        {/* Solutions */}
        <div className="bg-[#0F1E30] border border-[#00A8CC]/20 rounded-2xl p-8">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-7 h-7 rounded-lg bg-[#00A8CC]/15 flex items-center justify-center flex-shrink-0">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                <path d="M2 6.5l3 3 6-6" stroke="#00A8CC" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3 className="font-semibold text-white">With Cargo</h3>
          </div>
          <ul className="space-y-4">
            {solutions.map((s) => (
              <li key={s} className="flex items-start gap-3 text-sm text-white/60">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#00A8CC]/60 flex-shrink-0" />
                {s}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  </section>
);

/* ─── Section: Feature Highlights ───────────────────────────────────────── */
const features = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="2" y="2" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <rect x="11" y="2" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <rect x="2" y="11" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <rect x="11" y="11" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
    title: 'Inventory Intelligence',
    description:
      'Four-level location-based navigation gives every crew member instant access to any item on the vessel. Smart import, barcode scanning, and automated low-stock tracking.',
    href: '/features',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="6" r="3" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="4" cy="15" r="2" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="16" cy="15" r="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 14.5C7 12.6 8.3 11 10 11s3 1.6 3 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    title: 'Crew & Scheduling',
    description:
      'Duty sets, rotation management, and individual crew profiles in one place. Assign roles, track certifications, and keep everyone on the same schedule.',
    href: '/features',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M3 6a2 2 0 012-2h10a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V6z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 4V3M13 4V3M3 9h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    title: 'Trips & Guests',
    description:
      'Full trip lifecycle management — itinerary, guest allocation, and preference syncing. Every guest preference is available to every crew member for every charter.',
    href: '/features',
  },
];

const FeaturesHighlight = () => (
  <section className="py-24 px-6 bg-[#060E1A]">
    <div className="max-w-7xl mx-auto">
      <div className="text-center mb-16">
        <p className="text-[#00A8CC] text-xs font-semibold uppercase tracking-widest mb-4">Core capabilities</p>
        <h2 className="font-heading text-3xl sm:text-4xl font-bold text-white mb-4">
          Everything your vessel needs to run
        </h2>
        <p className="text-white/45 text-lg max-w-2xl mx-auto">
          Cargo covers the full operational surface of a modern vessel, with depth
          in each module that purpose-built tools can't match.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {features.map(({ icon, title, description, href }) => (
          <div
            key={title}
            className="group bg-[#141D2E] border border-white/[0.07] hover:border-white/[0.12] rounded-2xl p-7 transition-colors duration-200"
          >
            <div className="w-10 h-10 rounded-xl bg-[#00A8CC]/10 text-[#00A8CC] flex items-center justify-center mb-5">
              {icon}
            </div>
            <h3 className="font-heading font-semibold text-lg text-white mb-3">{title}</h3>
            <p className="text-sm text-white/45 leading-relaxed mb-5">{description}</p>
            <Link
              to={href}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-[#00A8CC] hover:text-white transition-colors duration-200"
            >
              Learn more
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>
        ))}
      </div>
    </div>
  </section>
);

/* ─── Section: Module strip ──────────────────────────────────────────────── */
const modules = [
  'Inventory', 'Crew Scheduling', 'Trip Management', 'Guest Profiles',
  'Defect Tracking', 'Laundry', 'Ops Calendar', 'Duty Sets',
  'Activity Feed', 'Vessel Blueprint', 'Locations', 'Logs & Deliveries',
];

const ModuleStrip = () => (
  <section className="py-24 px-6">
    <div className="max-w-7xl mx-auto">
      <div className="text-center mb-12">
        <p className="text-[#00A8CC] text-xs font-semibold uppercase tracking-widest mb-4">One platform</p>
        <h2 className="font-heading text-3xl sm:text-4xl font-bold text-white">
          Every module your operation needs
        </h2>
      </div>
      <div className="flex flex-wrap justify-center gap-2.5">
        {modules.map((mod) => (
          <span
            key={mod}
            className="px-4 py-2 bg-[#141D2E] border border-white/[0.07] rounded-full text-sm text-white/50"
          >
            {mod}
          </span>
        ))}
      </div>
    </div>
  </section>
);

/* ─── Section: CTA Banner ────────────────────────────────────────────────── */
const CTABanner = () => (
  <section className="py-24 px-6">
    <div className="max-w-3xl mx-auto">
      <div className="relative bg-gradient-to-br from-[#0F1E30] to-[#0B1220] border border-[#00A8CC]/20 rounded-3xl p-12 text-center overflow-hidden">
        {/* Glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 bg-[#00A8CC]/10 blur-3xl rounded-full" />
        <div className="relative">
          <h2 className="font-heading text-3xl sm:text-4xl font-bold text-white mb-4">
            Ready to bring order to your vessel ops?
          </h2>
          <p className="text-white/45 text-lg mb-8 max-w-xl mx-auto">
            Book a demo and see how Cargo works for your specific vessel and crew structure.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/contact"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-[#00A8CC] hover:bg-[#0094B3] text-white font-semibold px-7 py-3.5 rounded-xl transition-colors duration-200 shadow-lg shadow-[#00A8CC]/20"
            >
              Book a Demo
            </Link>
            <Link
              to="/contact"
              className="w-full sm:w-auto inline-flex items-center justify-center border border-white/[0.12] hover:border-white/[0.22] text-white/60 hover:text-white font-medium px-7 py-3.5 rounded-xl transition-colors duration-200"
            >
              Join the Waitlist
            </Link>
          </div>
        </div>
      </div>
    </div>
  </section>
);

/* ─── Page ───────────────────────────────────────────────────────────────── */
const HomePage = () => (
  <MarketingLayout>
    <HeroSection />
    <StatsStrip />
    <ProblemSolution />
    <FeaturesHighlight />
    <ModuleStrip />
    <CTABanner />
  </MarketingLayout>
);

export default HomePage;

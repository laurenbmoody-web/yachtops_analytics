import React from 'react';
import { Link } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';

/* ─── Shared ─────────────────────────────────────────────────────────────── */
const CTABanner = () => (
  <section className="py-24 px-6">
    <div className="max-w-3xl mx-auto">
      <div className="relative bg-gradient-to-br from-[#0F1E30] to-[#0B1220] border border-[#00A8CC]/20 rounded-3xl p-12 text-center overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 bg-[#00A8CC]/10 blur-3xl rounded-full" />
        <div className="relative">
          <h2 className="font-heading text-3xl font-bold text-white mb-4">Want to see these in action?</h2>
          <p className="text-white/45 text-lg mb-8">Book a demo and we'll walk through any module with you live.</p>
          <Link
            to="/contact"
            className="inline-flex items-center gap-2 bg-[#00A8CC] hover:bg-[#0094B3] text-white font-semibold px-7 py-3.5 rounded-xl transition-colors duration-200 shadow-lg shadow-[#00A8CC]/20"
          >
            Book a Demo
          </Link>
        </div>
      </div>
    </div>
  </section>
);

/* ─── Feature category block ─────────────────────────────────────────────── */
const FeatureBlock = ({ color, bg, eyebrow, headline, sub, features, flip = false }) => (
  <section className="py-20 px-6">
    <div className="max-w-7xl mx-auto">
      <div className={`grid lg:grid-cols-2 gap-12 items-start ${flip ? 'lg:grid-flow-col-dense' : ''}`}>
        {/* Copy */}
        <div className={flip ? 'lg:col-start-2' : ''}>
          <p className={`text-xs font-semibold uppercase tracking-widest mb-4 ${color}`}>{eyebrow}</p>
          <h2 className="font-heading text-3xl sm:text-4xl font-bold text-white leading-tight mb-4">{headline}</h2>
          <p className="text-white/45 text-lg leading-relaxed">{sub}</p>
        </div>
        {/* Feature list */}
        <div className={`grid sm:grid-cols-2 gap-4 ${flip ? 'lg:col-start-1' : ''}`}>
          {features.map(({ title, body }) => (
            <div key={title} className="bg-[#141D2E] border border-white/[0.07] rounded-xl p-5">
              <div className={`w-2 h-2 rounded-full mb-3 ${bg}`} />
              <h4 className="font-heading font-semibold text-sm text-white mb-1.5">{title}</h4>
              <p className="text-xs text-white/40 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

/* ─── Feature data ───────────────────────────────────────────────────────── */
const inventoryFeatures = [
  { title: '4-Level location navigation', body: 'Drill from vessel area down to shelf and bin. Every item is exactly where it should be.' },
  { title: 'Smart bulk import', body: 'Upload a CSV or spreadsheet and Cargo auto-assigns categories and locations using intelligent matching.' },
  { title: 'Analytics dashboard', body: 'Consumption trends, low-stock alerts, and spending patterns across all inventory categories.' },
  { title: 'Location management', body: 'Add, rename, and restructure storage locations without disrupting existing inventory data.' },
  { title: 'Category settings', body: 'Custom category taxonomy that matches how your vessel actually stores things.' },
  { title: 'Item detail views', body: 'Full item history, notes, reorder thresholds, and usage logs in a single read-first view.' },
];

const crewFeatures = [
  { title: 'Role-based access', body: 'COMMAND, CHIEF, and crew tiers control exactly what each person can view and edit.' },
  { title: 'Crew profiles', body: 'Photo, qualifications, certifications, contact details, and notes — all in one profile.' },
  { title: 'Duty sets', body: 'Define rotating duty structures and assign crew to watch schedules without spreadsheets.' },
  { title: 'Rotation management', body: 'Plan and publish crew rotations weeks in advance with visibility for the whole team.' },
  { title: 'Team jobs', body: 'Assign ad-hoc and recurring jobs to individuals or teams with status tracking.' },
  { title: 'Invite system', body: 'Send secure email invites for new crew. Onboarding flow captures all required details.' },
];

const tripFeatures = [
  { title: 'Trip lifecycle', body: 'Create, plan, run, and archive voyages. Each trip has a complete history and guest manifest.' },
  { title: 'Itinerary timeline', body: 'Visual stop-by-stop itinerary builder with dates, ports, and activity notes.' },
  { title: 'Guest allocation', body: 'Assign guests to trips and cabins. Preference profiles travel with them automatically.' },
  { title: 'Trips calendar', body: 'Overview of all upcoming and past trips on a shared ops calendar.' },
  { title: 'Guest preference sync', body: 'Dietary requirements, cabin preferences, and activity interests are available on every trip.' },
  { title: 'Preference directory', body: 'A master directory of all guest preferences searchable across your full guest history.' },
];

const opsFeatures = [
  { title: 'Defect tracking', body: 'Log, categorise, and assign defects. Track them from report through to close-out with crew accountability.' },
  { title: 'Vessel blueprint view', body: 'Spatial map of the vessel. Attach defects and items to specific areas for instant context.' },
  { title: 'Ops calendar', body: 'A combined view of crew schedules, trips, and maintenance events in one calendar.' },
  { title: 'Activity feed', body: 'A live log of everything happening across the vessel — inventory changes, defects, assignments.' },
  { title: 'Laundry management', body: 'Track laundry cycles, assignments, and history. A surprisingly important ops gap Cargo fills.' },
  { title: 'Logs & deliveries', body: 'Record provisions deliveries and operational logs tied to dates, crew, and vessel locations.' },
];

/* ─── Page ───────────────────────────────────────────────────────────────── */
const FeaturesPage = () => (
  <MarketingLayout>
    {/* Hero */}
    <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-24 px-6 text-center overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-[#00A8CC]/[0.06] blur-[100px] rounded-full pointer-events-none" />
      <div className="relative max-w-3xl mx-auto">
        <p className="text-[#00A8CC] text-xs font-semibold uppercase tracking-widest mb-5">Features</p>
        <h1 className="font-heading text-4xl sm:text-5xl font-bold text-white leading-[1.08] tracking-tight mb-5">
          Every feature your crew needs
        </h1>
        <p className="text-lg text-white/50 leading-relaxed max-w-2xl mx-auto">
          Cargo is built deep, not wide. Each module has the features real vessel teams need —
          not watered-down versions of generic software.
        </p>
      </div>
    </section>

    {/* Feature divider */}
    <div className="max-w-7xl mx-auto px-6">
      <div className="border-t border-white/[0.06]" />
    </div>

    <FeatureBlock
      color="text-[#00A8CC]"
      bg="bg-[#00A8CC]"
      eyebrow="Inventory"
      headline="Know exactly what you have and where it is"
      sub="Four levels of location hierarchy give you pinpoint accuracy. Smart import gets you from spreadsheet to searchable inventory in minutes."
      features={inventoryFeatures}
    />

    <div className="max-w-7xl mx-auto px-6"><div className="border-t border-white/[0.06]" /></div>

    <FeatureBlock
      color="text-violet-400"
      bg="bg-violet-400"
      eyebrow="Crew & Scheduling"
      headline="Your crew, organised and accountable"
      sub="From role-based access to duty sets and rotation planning, Cargo gives you full visibility of who's doing what and when."
      features={crewFeatures}
      flip
    />

    <div className="max-w-7xl mx-auto px-6"><div className="border-t border-white/[0.06]" /></div>

    <FeatureBlock
      color="text-emerald-400"
      bg="bg-emerald-400"
      eyebrow="Trips & Guests"
      headline="Charter operations without the chaos"
      sub="A complete trip management system that connects itineraries, guests, and preferences so every charter runs smoothly."
      features={tripFeatures}
    />

    <div className="max-w-7xl mx-auto px-6"><div className="border-t border-white/[0.06]" /></div>

    <FeatureBlock
      color="text-amber-400"
      bg="bg-amber-400"
      eyebrow="Operations & Maintenance"
      headline="The operational layer everything else depends on"
      sub="Defect tracking, vessel blueprint views, activity logs, laundry, and a combined ops calendar keep the whole vessel running."
      features={opsFeatures}
      flip
    />

    <CTABanner />
  </MarketingLayout>
);

export default FeaturesPage;

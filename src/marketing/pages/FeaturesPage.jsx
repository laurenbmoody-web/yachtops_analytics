import React from 'react';
import { Link } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';

/* ─── Shared ─────────────────────────────────────────────────────────────── */
const Eyebrow = ({ children, color = '#4A90E2' }) => (
  <p className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color, marginBottom: 10 }}>
    {children}
  </p>
);

/* ─── Feature block ──────────────────────────────────────────────────────── */
const FeatureBlock = ({ eyebrow, headline, sub, features, accent = '#4A90E2', flip = false }) => (
  <section style={{ padding: '72px 32px', borderBottom: '1px solid #E2E8F0' }}>
    <div style={{ maxWidth: 1280, margin: '0 auto' }}>
      <div className={`grid lg:grid-cols-2 gap-12 items-start ${flip ? 'lg:[direction:rtl]' : ''}`}>
        <div className={flip ? 'lg:[direction:ltr]' : ''}>
          <Eyebrow color={accent}>{eyebrow}</Eyebrow>
          <h2 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 28, color: '#1E3A5F', lineHeight: 1.15, marginBottom: 10 }}>{headline}</h2>
          <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: '#64748B', lineHeight: 1.7 }}>{sub}</p>
        </div>
        <div className={`grid sm:grid-cols-2 gap-3 ${flip ? 'lg:[direction:ltr]' : ''}`}>
          {features.map(({ title, body }, i) => (
            <div key={title} className="bg-white rounded-xl p-5 group hover:bg-[#141D2E] transition-all duration-200" style={{ border: '2px solid #1E3A5F' }}>
              <p className="mkt-archivo group-hover:text-white" style={{ fontWeight: 900, fontSize: 22, color: '#4A90E2', marginBottom: 3 }}>
                {String(i + 1).padStart(2, '0')}
              </p>
              <h4 className="mkt-archivo group-hover:text-white" style={{ fontWeight: 900, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1E3A5F', marginBottom: 5 }}>{title}</h4>
              <p className="mkt-dmsans group-hover:text-[#94A3B8]" style={{ fontWeight: 400, fontSize: 11, color: '#64748B', lineHeight: 1.55 }}>{body}</p>
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
  { title: 'Smart bulk import', body: 'Upload a CSV and Cargo auto-assigns categories and locations using intelligent matching.' },
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
  { title: 'Defect tracking', body: 'Log, categorise, and assign defects. Track them from report through to close-out.' },
  { title: 'Vessel blueprint view', body: 'Spatial map of the vessel. Attach defects and items to specific areas for instant context.' },
  { title: 'Ops calendar', body: 'A combined view of crew schedules, trips, and maintenance events in one calendar.' },
  { title: 'Activity feed', body: 'A live log of everything happening across the vessel — inventory changes, defects, assignments.' },
  { title: 'Laundry management', body: 'Track laundry cycles, assignments, and history. A surprisingly important ops gap Cargo fills.' },
  { title: 'Logs & deliveries', body: 'Record provisions deliveries and operational logs tied to dates, crew, and vessel locations.' },
];

/* ─── CTA ────────────────────────────────────────────────────────────────── */
const CTABanner = () => (
  <section style={{ padding: '72px 32px' }}>
    <div className="rounded-2xl text-center" style={{ maxWidth: 860, margin: '0 auto', backgroundColor: '#1E3A5F', padding: '56px 40px' }}>
      <p className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(74,144,226,0.8)', marginBottom: 12 }}>Get started</p>
      <h2 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 26, color: 'white', lineHeight: 1.15, marginBottom: 10 }}>Want to see these in action?</h2>
      <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: 'rgba(255,255,255,0.55)', maxWidth: 400, margin: '0 auto 28px', lineHeight: 1.65 }}>
        Book a demo and we'll walk through any module with you live.
      </p>
      <Link to="/contact" className="mkt-archivo transition-colors duration-150"
        style={{ fontWeight: 900, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#1E3A5F', backgroundColor: 'white', borderRadius: 50, padding: '10px 24px', textDecoration: 'none', display: 'inline-block' }}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F8FAFC')}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'white')}
      >Book a Demo</Link>
    </div>
  </section>
);

/* ─── Page ───────────────────────────────────────────────────────────────── */
const FeaturesPage = () => (
  <MarketingLayout>
    {/* Hero */}
    <section style={{ paddingTop: 96, paddingBottom: 56, borderBottom: '1px solid #E2E8F0', textAlign: 'center' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 32px' }}>
        <Eyebrow>Features</Eyebrow>
        <h1 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 38, textTransform: 'uppercase', color: '#1E3A5F', lineHeight: 1.05, marginBottom: 14 }}>
          Every feature your crew needs
        </h1>
        <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 15, color: '#64748B', maxWidth: 520, margin: '0 auto', lineHeight: 1.7 }}>
          Cargo is built deep, not wide. Each module has the features real vessel teams need — not watered-down versions of generic software.
        </p>
      </div>
    </section>

    <FeatureBlock eyebrow="Inventory" headline="Know exactly what you have and where it is" sub="Four levels of location hierarchy give you pinpoint accuracy. Smart import gets you from spreadsheet to searchable inventory in minutes." features={inventoryFeatures} />
    <FeatureBlock eyebrow="Crew & Scheduling" headline="Your crew, organised and accountable" sub="From role-based access to duty sets and rotation planning, Cargo gives you full visibility of who's doing what and when." features={crewFeatures} flip />
    <FeatureBlock eyebrow="Trips & Guests" headline="Charter operations without the chaos" sub="A complete trip management system that connects itineraries, guests, and preferences so every charter runs smoothly." features={tripFeatures} />
    <FeatureBlock eyebrow="Operations & Maintenance" headline="The operational layer everything depends on" sub="Defect tracking, vessel blueprint views, activity logs, laundry, and a combined ops calendar keep the whole vessel running." features={opsFeatures} flip />

    <CTABanner />
  </MarketingLayout>
);

export default FeaturesPage;

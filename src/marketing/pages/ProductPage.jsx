import React from 'react';
import { Link } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';

/* ─── Shared primitives ──────────────────────────────────────────────────── */
const Eyebrow = ({ children }) => (
  <p className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#4A90E2', marginBottom: 10 }}>
    {children}
  </p>
);

const SectionHeading = ({ eyebrow, headline, sub, center = true }) => (
  <div className={center ? 'text-center' : ''} style={{ marginBottom: 48 }}>
    {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
    <h2 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 28, color: '#1E3A5F', lineHeight: 1.15, marginBottom: sub ? 10 : 0 }}>
      {headline}
    </h2>
    {sub && (
      <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: '#64748B', maxWidth: 480, margin: center ? '0 auto' : undefined, lineHeight: 1.65 }}>
        {sub}
      </p>
    )}
  </div>
);

const PillPrimary = ({ to, children }) => (
  <Link to={to} className="mkt-archivo inline-block transition-colors duration-150"
    style={{ fontWeight: 900, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'white', backgroundColor: '#1E3A5F', borderRadius: 50, padding: '10px 22px', textDecoration: 'none' }}
    onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#141D2E')}
    onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#1E3A5F')}
  >{children}</Link>
);

const PillSecondary = ({ to, children }) => (
  <Link to={to} className="mkt-archivo inline-block transition-colors duration-150"
    style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#1E3A5F', border: '2px solid #1E3A5F', backgroundColor: 'transparent', borderRadius: 50, padding: '8px 22px', textDecoration: 'none' }}
    onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#1E3A5F'; e.currentTarget.style.color = 'white'; }}
    onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#1E3A5F'; }}
  >{children}</Link>
);

/* ─── Page hero ──────────────────────────────────────────────────────────── */
const PageHero = ({ eyebrow, headline, sub }) => (
  <section style={{ paddingTop: 96, paddingBottom: 64, borderBottom: '1px solid #E2E8F0' }}>
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 32px', textAlign: 'center' }}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h1 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 38, textTransform: 'uppercase', color: '#1E3A5F', lineHeight: 1.05, marginBottom: 14 }}>
        {headline}
      </h1>
      {sub && (
        <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 15, color: '#64748B', maxWidth: 520, margin: '0 auto', lineHeight: 1.7 }}>
          {sub}
        </p>
      )}
    </div>
  </section>
);

/* ─── How it works ───────────────────────────────────────────────────────── */
const STEPS = [
  { n: '01', title: 'Set up your vessel', body: 'Add your vessel profile, define locations and storage areas, and configure your crew structure. Cargo maps to how your vessel is actually organised.' },
  { n: '02', title: 'Onboard your crew', body: 'Invite crew by role and email. Each person gets the access level they need — COMMAND, CHIEF, or standard crew. Roles enforce what each person can see and do.' },
  { n: '03', title: 'Run everything from one place', body: 'Inventory, scheduling, trips, guests, defects — all accessible from the same system, all connected to the same vessel context.' },
];

const HowItWorks = () => (
  <section style={{ padding: '72px 32px', maxWidth: 1280, margin: '0 auto' }}>
    <SectionHeading eyebrow="How it works" headline="Up and running in days, not months" sub="Cargo is built for vessels that operate now. No months-long implementation projects." />
    <div className="grid md:grid-cols-3 gap-8" style={{ maxWidth: 960, margin: '0 auto' }}>
      {STEPS.map(({ n, title, body }) => (
        <div key={n}>
          <p className="mkt-archivo" style={{ fontWeight: 900, fontSize: 40, color: 'rgba(74,144,226,0.15)', lineHeight: 1, marginBottom: 12 }}>{n}</p>
          <h3 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1E3A5F', marginBottom: 8 }}>{title}</h3>
          <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 13, color: '#64748B', lineHeight: 1.65 }}>{body}</p>
        </div>
      ))}
    </div>
  </section>
);

/* ─── Module overview ────────────────────────────────────────────────────── */
const MODULES = [
  { n: '01', title: 'Inventory', body: 'Four-level location hierarchy, smart bulk import, analytics, and real-time item status across every storage area on the vessel.' },
  { n: '02', title: 'Crew Management', body: 'Profiles, role assignments, onboarding flows, and individual skill/certification visibility for every person aboard.' },
  { n: '03', title: 'Trips & Itineraries', body: 'Full charter and voyage lifecycle — from initial booking through itinerary planning, guest allocation, and post-trip history.' },
  { n: '04', title: 'Guest Profiles', body: 'Comprehensive preference management for every guest. Dietary needs, cabin preferences, activities — synced to every trip they join.' },
  { n: '05', title: 'Defect Tracking', body: 'Log, assign, and close out maintenance defects. Link them to vessel areas, crew members, and trip schedules.' },
  { n: '06', title: 'Ops Calendar', body: 'A vessel-wide operational calendar that surfaces trips, duty rotations, crew leave, and maintenance windows in one view.' },
];

const ModuleOverview = () => (
  <section style={{ padding: '72px 32px', backgroundColor: 'white', borderTop: '1px solid #E2E8F0', borderBottom: '1px solid #E2E8F0' }}>
    <div style={{ maxWidth: 1280, margin: '0 auto' }}>
      <SectionHeading eyebrow="What's inside" headline="Six core modules. One coherent platform." sub="Each module is purpose-built but connected — data flows between them so you're never entering the same thing twice." />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {MODULES.map(({ n, title, body }) => (
          <div key={n} className="rounded-xl p-5 bg-[#F8FAFC]" style={{ border: '2px solid #1E3A5F' }}>
            <p className="mkt-archivo" style={{ fontWeight: 900, fontSize: 22, color: '#4A90E2', marginBottom: 3 }}>{n}</p>
            <h3 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1E3A5F', marginBottom: 6 }}>{title}</h3>
            <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 12, color: '#64748B', lineHeight: 1.6 }}>{body}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

/* ─── Comparison table ───────────────────────────────────────────────────── */
const ROWS = [
  { label: 'Built for yacht ops', cargo: true, generic: false },
  { label: 'Role-based crew access', cargo: true, generic: false },
  { label: 'Location-first inventory', cargo: true, generic: false },
  { label: 'Guest preference management', cargo: true, generic: false },
  { label: 'Integrated trip & crew calendar', cargo: true, generic: false },
  { label: 'Voyage & defect history', cargo: true, generic: false },
  { label: 'Mobile-ready for crew', cargo: true, generic: true },
  { label: 'Cloud-hosted', cargo: true, generic: true },
];

const Check = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="7" fill="rgba(74,144,226,0.12)" />
    <path d="M4.5 8l2.5 2.5L11.5 5" stroke="#4A90E2" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Cross = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="7" fill="rgba(248,113,113,0.1)" />
    <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#F87171" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const WhyCargo = () => (
  <section style={{ padding: '72px 32px', maxWidth: 860, margin: '0 auto' }}>
    <SectionHeading eyebrow="Why Cargo" headline="Not adapted from hotel or fleet software" sub="Generic operations tools miss what makes yacht ops unique. Cargo was built for it." />
    <div className="bg-white rounded-xl overflow-hidden" style={{ border: '2px solid #1E3A5F' }}>
      <div className="grid grid-cols-3 px-6 py-4" style={{ borderBottom: '1px solid #E2E8F0' }}>
        <span className="mkt-archivo col-span-1" style={{ fontWeight: 900, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#64748B' }}>Capability</span>
        <span className="mkt-archivo text-center" style={{ fontWeight: 900, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#1E3A5F' }}>Cargo</span>
        <span className="mkt-archivo text-center" style={{ fontWeight: 900, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#64748B' }}>Generic tools</span>
      </div>
      {ROWS.map(({ label, cargo, generic }, i) => (
        <div
          key={label}
          className="grid grid-cols-3 items-center px-6 py-3"
          style={{ borderBottom: i < ROWS.length - 1 ? '1px solid #F1F5F9' : 'none' }}
        >
          <span className="mkt-dmsans col-span-1" style={{ fontWeight: 400, fontSize: 13, color: '#64748B' }}>{label}</span>
          <span className="flex justify-center">{cargo ? <Check /> : <Cross />}</span>
          <span className="flex justify-center">{generic ? <Check /> : <Cross />}</span>
        </div>
      ))}
    </div>
  </section>
);

/* ─── CTA ────────────────────────────────────────────────────────────────── */
const CTABanner = () => (
  <section style={{ padding: '0 32px 80px' }}>
    <div className="rounded-2xl text-center" style={{ maxWidth: 860, margin: '0 auto', backgroundColor: '#1E3A5F', padding: '56px 40px' }}>
      <p className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(74,144,226,0.8)', marginBottom: 12 }}>Get started</p>
      <h2 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 26, color: 'white', lineHeight: 1.15, marginBottom: 10 }}>Ready to see Cargo in action?</h2>
      <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: 'rgba(255,255,255,0.55)', maxWidth: 400, margin: '0 auto 28px', lineHeight: 1.65 }}>
        Book a 30-minute demo and we'll walk through it with your specific vessel in mind.
      </p>
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <Link to="/contact" className="mkt-archivo transition-colors duration-150"
          style={{ fontWeight: 900, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#1E3A5F', backgroundColor: 'white', borderRadius: 50, padding: '10px 24px', textDecoration: 'none' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F8FAFC')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'white')}
        >Book a Demo</Link>
        <Link to="/features" className="mkt-archivo transition-colors duration-150"
          style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'white', border: '2px solid rgba(255,255,255,0.4)', borderRadius: 50, padding: '8px 24px', textDecoration: 'none' }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.7)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)')}
        >Explore Features</Link>
      </div>
    </div>
  </section>
);

/* ─── Page ───────────────────────────────────────────────────────────────── */
const ProductPage = () => (
  <MarketingLayout>
    <PageHero eyebrow="The product" headline="One platform. End-to-end vessel operations." sub="Cargo replaces the patchwork of spreadsheets, chat threads, and disconnected apps that most vessel teams rely on today." />
    <HowItWorks />
    <ModuleOverview />
    <WhyCargo />
    <CTABanner />
  </MarketingLayout>
);

export default ProductPage;

import React from 'react';
import { Link } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';

/* ─── Pill buttons ───────────────────────────────────────────────────────── */
const PillPrimary = ({ to, children }) => (
  <Link
    to={to}
    className="mkt-archivo inline-block transition-colors duration-150"
    style={{
      fontWeight: 900, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
      color: 'white', backgroundColor: '#1E3A5F', borderRadius: 50,
      padding: '12px 22px 10px',
      textDecoration: 'none',
    }}
    onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#141D2E')}
    onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#1E3A5F')}
  >
    {children}
  </Link>
);

const PillSecondary = ({ to, children }) => (
  <Link
    to={to}
    className="mkt-archivo inline-block transition-colors duration-150"
    style={{
      fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
      color: '#1E3A5F', border: '2px solid #1E3A5F', backgroundColor: 'transparent',
      borderRadius: 50, padding: '8px 22px', textDecoration: 'none',
    }}
    onMouseEnter={e => {
      e.currentTarget.style.backgroundColor = '#1E3A5F';
      e.currentTarget.style.color = 'white';
    }}
    onMouseLeave={e => {
      e.currentTarget.style.backgroundColor = 'transparent';
      e.currentTarget.style.color = '#1E3A5F';
    }}
  >
    {children}
  </Link>
);

/* ─── Dashboard mockup ───────────────────────────────────────────────────── */
// TODO: Replace with real system screenshot when available
const DashboardMockup = () => (
  <div className="relative w-full max-w-lg">
    <div
      className="relative rounded-2xl overflow-hidden shadow-2xl"
      style={{ backgroundColor: '#0E1726', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      {/* Title bar */}
      <div
        className="flex items-center gap-2 px-5 py-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', backgroundColor: '#0B1220' }}
      >
        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#FF5F57' }} />
        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#FEBC2E' }} />
        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#28C840' }} />
        <span className="ml-3 mkt-dmsans" style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>
          Cargo — Dashboard
        </span>
      </div>
      {/* Layout */}
      <div className="flex" style={{ height: 320 }}>
        {/* Sidebar */}
        <div
          className="flex flex-col gap-1 p-3"
          style={{ width: 160, borderRight: '1px solid rgba(255,255,255,0.06)', backgroundColor: 'rgba(11,18,32,0.6)', flexShrink: 0 }}
        >
          {[
            { label: 'Today', active: true },
            { label: 'Inventory' },
            { label: 'Crew' },
            { label: 'Trips' },
            { label: 'Guests' },
            { label: 'Defects' },
          ].map(({ label, active }) => (
            <div
              key={label}
              className="flex items-center gap-2 px-3 py-2 rounded-md mkt-dmsans"
              style={{
                fontSize: 11,
                color: active ? '#4A90E2' : 'rgba(255,255,255,0.3)',
                backgroundColor: active ? 'rgba(74,144,226,0.12)' : 'transparent',
              }}
            >
              <div
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: active ? '#4A90E2' : 'rgba(255,255,255,0.15)' }}
              />
              {label}
            </div>
          ))}
        </div>
        {/* Content */}
        <div className="flex-1 p-5 overflow-hidden">
          <p className="mkt-archivo" style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: 14 }}>
            Today — 19 Mar
          </p>
          <div className="grid grid-cols-3 gap-2 mb-5">
            {[{ label: 'Open Tasks', value: '12' }, { label: 'Crew On', value: '8' }, { label: 'Defects', value: '3' }].map(({ label, value }) => (
              <div
                key={label}
                className="rounded-lg p-3"
                style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <p className="mkt-dmsans" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>{label}</p>
                <p className="mkt-archivo" style={{ fontSize: 22, fontWeight: 900, color: 'white' }}>{value}</p>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { dot: '#4A90E2', text: 'Engine room inventory sync complete' },
              { dot: '#F59E0B', text: 'Defect #14 assigned to Chief Eng.' },
              { dot: '#10B981', text: 'Trip "Monaco → Portofino" confirmed' },
              { dot: 'rgba(255,255,255,0.2)', text: 'Crew rotation updated for April' },
            ].map(({ dot, text }, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />
                <p className="mkt-dmsans" style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  </div>
);

/* ─── Hero ───────────────────────────────────────────────────────────────── */
const HeroSection = () => (
  <section style={{ paddingTop: 96, paddingBottom: 80, overflowX: 'hidden' }}>
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 32px' }}>
      <div className="grid lg:grid-cols-2 gap-16 items-center">

        {/* Text */}
        <div>
          {/* Eyebrow */}
          <p
            className="mkt-archivo"
            style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#4A90E2', marginBottom: 20 }}
          >
            Built by crew, for crew
          </p>

          {/* Three-line headline */}
          <div style={{ marginBottom: 20 }}>
            <div
              className="mkt-archivo block"
              style={{ fontWeight: 900, fontSize: 38, textTransform: 'uppercase', color: '#1E3A5F', lineHeight: 1, marginBottom: 4 }}
            >
              THE OPS PLATFORM
            </div>
            <div
              className="mkt-archivo block"
              style={{ fontWeight: 900, fontSize: 38, textTransform: 'uppercase', color: '#1E3A5F', lineHeight: 1, marginBottom: 2 }}
            >
              BUILT FOR
            </div>
            {/* Line 3 — highlighted, bleeds left */}
            <div style={{ position: 'relative', display: 'inline-block', marginTop: 2 }}>
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute', top: 0, bottom: 0,
                  left: -9999, right: -12,
                  background: 'rgba(74,144,226,0.5)',
                  borderRadius: 8, zIndex: 0,
                }}
              />
              <span
                className="mkt-archivo"
                style={{
                  position: 'relative', zIndex: 1,
                  fontWeight: 900, fontSize: 38, textTransform: 'uppercase',
                  color: 'white', lineHeight: 1, padding: '5px 0', display: 'block',
                }}
              >
                REAL YACHT CREWS
              </span>
            </div>
          </div>

          {/* Body */}
          <p
            className="mkt-dmsans"
            style={{ fontWeight: 400, fontSize: 14, color: '#64748B', maxWidth: 420, lineHeight: 1.7, marginBottom: 24 }}
          >
            Cargo unifies crew and guest management, inventory, preferences and
            provisioning, trips, defects, accounts and many more operational
            details into one system.
          </p>

          {/* CTAs */}
          <div className="flex flex-wrap gap-3">
            <PillSecondary to="/features">Explore Features</PillSecondary>
          </div>
        </div>

        {/* Mockup */}
        <div className="hidden lg:flex justify-end">
          <DashboardMockup />
        </div>
      </div>
    </div>
  </section>
);

/* ─── Trust bar ──────────────────────────────────────────────────────────── */
const TrustBar = () => (
  <div
    style={{
      backgroundColor: '#1E3A5F',
      borderTop: '2px solid #1E3A5F',
      borderBottom: '2px solid #1E3A5F',
      padding: '14px 32px',
      textAlign: 'center',
    }}
  >
    <p
      className="mkt-archivo"
      style={{ fontWeight: 900, fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}
    >
      CREW OPS &nbsp;·&nbsp; GUEST OPS &nbsp;·&nbsp; VESSEL OPS
    </p>
  </div>
);

/* ─── Problem / Solution ─────────────────────────────────────────────────── */
const problems = [
  'Inventory scattered across different platforms and papers',
  'Crew schedules lost to Excel or WhatsApp',
  'Guest preferences etched in memory, not systems',
  'No single source of truth',
];

const solutions = [
  'Real-time inventory with interactive mapping',
  'Crew scheduling visible and logged',
  'Guest preferences synced, stored and smartly linked to provisioning',
  'One platform — your vessel\'s digital twin',
];

const ProblemSolution = () => (
  <section style={{ padding: '80px 32px', maxWidth: 1280, margin: '0 auto' }}>
    <div className="text-center mb-14">
      <p className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#4A90E2', marginBottom: 10 }}>
        The problem
      </p>
      <div style={{ borderLeft: '4px solid #4A90E2', paddingLeft: 16, marginBottom: 10, textAlign: 'left' }}>
        <p className="mkt-archivo" style={{ fontWeight: 900, fontSize: 22, textTransform: 'uppercase', color: '#1E3A5F', lineHeight: 1.05, marginBottom: 6 }}>
          Yachts are complex.
        </p>
        <p className="mkt-archivo" style={{ fontWeight: 900, fontSize: 16, textTransform: 'uppercase', color: '#64748B', lineHeight: 1.2 }}>
          Most software is built by people who've never set foot on one.
        </p>
      </div>
      <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: '#64748B', maxWidth: 480, margin: '0 auto' }}>
        Cargo was designed from the ground up for real vessel operations — not adapted from hotel or fleet software.
      </p>
    </div>

    <div className="grid md:grid-cols-2 gap-5" style={{ maxWidth: 860, margin: '0 auto' }}>
      {/* Without */}
      <div className="bg-white rounded-xl p-7" style={{ border: '2px solid #E2E8F0' }}>
        <div className="flex items-center gap-2 mb-6">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(248,113,113,0.12)' }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M2 2l9 9M11 2l-9 9" stroke="#F87171" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
          <h3 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1E3A5F' }}>
            Without Cargo
          </h3>
        </div>
        <ul style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {problems.map(p => (
            <li key={p} className="flex items-start gap-3">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: 'rgba(248,113,113,0.5)' }} />
              <span className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 13, color: '#64748B', lineHeight: 1.5 }}>{p}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* With Cargo */}
      <div className="bg-white rounded-xl p-7" style={{ border: '2px solid #1E3A5F' }}>
        <div className="flex items-center gap-2 mb-6">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(74,144,226,0.12)' }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M2 6.5l3 3 6-6" stroke="#4A90E2" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h3 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1E3A5F' }}>
            With Cargo
          </h3>
        </div>
        <ul style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {solutions.map(s => (
            <li key={s} className="flex items-start gap-3">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#4A90E2' }} />
              <span className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 13, color: '#64748B', lineHeight: 1.5 }}>{s}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  </section>
);

/* ─── CTA banner ─────────────────────────────────────────────────────────── */
const CTABanner = () => (
  <section style={{ padding: '0 32px 80px' }}>
    <div
      className="rounded-2xl text-center"
      style={{
        maxWidth: 860,
        margin: '0 auto',
        backgroundColor: '#1E3A5F',
        padding: '56px 40px',
      }}
    >
      <p className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(74,144,226,0.8)', marginBottom: 12 }}>
        Get started
      </p>
      <h2 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 28, color: 'white', lineHeight: 1.15, marginBottom: 10 }}>
        Ready to bring order to your vessel ops?
      </h2>
      <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: 'rgba(255,255,255,0.55)', maxWidth: 440, margin: '0 auto 28px' }}>
        Book a demo and see how Cargo works for your specific vessel and crew structure.
      </p>
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <Link
          to="/contact"
          className="mkt-archivo transition-colors duration-150"
          style={{
            fontWeight: 900, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: '#1E3A5F', backgroundColor: 'white', borderRadius: 50,
            padding: '10px 24px', textDecoration: 'none',
          }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F8FAFC')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'white')}
        >
          Book a Demo
        </Link>
        <Link
          to="/contact"
          className="mkt-archivo transition-colors duration-150"
          style={{
            fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: 'white', border: '2px solid rgba(255,255,255,0.4)', borderRadius: 50,
            padding: '8px 24px', textDecoration: 'none',
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.7)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)')}
        >
          Join the Waitlist
        </Link>
      </div>
    </div>
  </section>
);

/* ─── Page ───────────────────────────────────────────────────────────────── */
const HomePage = () => (
  <MarketingLayout>
    <HeroSection />
    <TrustBar />
    <ProblemSolution />
    <CTABanner />
  </MarketingLayout>
);

export default HomePage;

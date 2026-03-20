import React, { useState, useRef, useEffect } from 'react';
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

/* ─── Four Pillars ───────────────────────────────────────────────────────── */
const PETAL_MAP = { crew: 'tl', vessel: 'tr', guest: 'bl', continuity: 'br' };
const PETAL_TRANSFORMS = { tl: 'translate(-5px, -5px)', tr: 'translate(5px, -5px)', bl: 'translate(-5px, 5px)', br: 'translate(5px, 5px)' };
const PETAL_ORIGINS = { tl: '65% 65%', tr: '35% 65%', bl: '65% 35%', br: '35% 35%' };

const PILLARS = [
  {
    id: 'crew',
    nav: 'CREW OPS',
    heading: 'MANAGING THE PEOPLE WHO RUN THE VESSEL',
    body: 'From duty sets and scheduling to crew profiles and hours of rest — every person, every shift, every rotation, logged and visible in one place.',
    modules: ['Crew Scheduling', 'Duty Sets', 'Hours of Rest', 'Crew Profiles', 'Activity Feed'],
    mockupLabel: 'Crew Scheduling',
  },
  {
    id: 'vessel',
    nav: 'VESSEL OPS',
    heading: 'EVERYTHING TO DO WITH THE PHYSICAL VESSEL',
    body: "Real-time inventory with interactive location mapping, defect tracking, logs, deliveries, and a full vessel blueprint — your vessel's digital twin.",
    modules: ['Inventory', 'Locations', 'Defect Tracking', 'Vessel Blueprint', 'Logs & Deliveries'],
    mockupLabel: 'Inventory',
  },
  {
    id: 'guest',
    nav: 'GUEST OPS',
    heading: 'EVERYTHING THAT TOUCHES THE GUEST EXPERIENCE',
    body: 'Guest preferences synced to every trip, provisioning linked to profiles, APA tracking, and a full trip lifecycle from planning to post-charter.',
    modules: ['Guest Profiles', 'Trip Management', 'Provisioning', 'APA & Spend', 'Ops Calendar'],
    mockupLabel: 'Guest Profiles',
  },
  {
    id: 'continuity',
    nav: 'CONTINUITY',
    heading: 'THE KNOWLEDGE THAT STAYS WHEN CREW CHANGES',
    body: 'Laundry logs, handover notes, operational history and institutional memory — everything that makes the next crew as good as the last.',
    modules: ['Laundry Logs', 'Handover Notes', 'Operational Logs', 'Knowledge Retention'],
    mockupLabel: 'Handover Notes',
  },
];

const CargoLogoNav = ({ activePillar }) => {
  const ap = PETAL_MAP[activePillar];
  return (
    <svg width="64" height="64" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', margin: '0 auto 16px' }}>
      <defs>
        <clipPath id="fp-clip-tl"><rect x="0" y="0" width="14" height="14" /></clipPath>
        <clipPath id="fp-clip-tr"><rect x="14" y="0" width="14" height="14" /></clipPath>
        <clipPath id="fp-clip-bl"><rect x="0" y="14" width="14" height="14" /></clipPath>
        <clipPath id="fp-clip-br"><rect x="14" y="14" width="14" height="14" /></clipPath>
      </defs>
      {['tl', 'tr', 'bl', 'br'].map(p => (
        <g
          key={p}
          style={{
            transform: ap === p ? PETAL_TRANSFORMS[p] : 'translate(0, 0)',
            transformOrigin: PETAL_ORIGINS[p],
            transition: 'transform 0.4s cubic-bezier(0.34, 1.4, 0.64, 1)',
          }}
        >
          <rect
            x="0" y="0" width="28" height="28" rx="5"
            fill={ap === p ? '#0d1f35' : '#1E3A5F'}
            clipPath={`url(#fp-clip-${p})`}
            style={{ transition: 'fill 0.3s ease' }}
          />
        </g>
      ))}
      <path d="M20 9a7 7 0 1 0 0 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  );
};

const PetalIcon = ({ petal }) => {
  const viewBoxes = { tl: '0 0 14 14', tr: '14 0 14 14', bl: '0 14 14 14', br: '14 14 14 14' };
  return (
    <svg width="16" height="16" viewBox={viewBoxes[petal]} fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="28" height="28" rx="5" fill="#4A90E2" />
      <path d="M20 9a7 7 0 1 0 0 10" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
};

const MockupScreen = ({ label }) => (
  <div style={{ backgroundColor: '#0B1220', borderRadius: 10, padding: 14 }}>
    <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#ef4444' }} />
      <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#f59e0b' }} />
      <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#22c55e' }} />
    </div>
    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 9, color: 'rgba(255,255,255,0.35)', marginBottom: 10 }}>{label}</p>
    {[80, 60, 90, 45, 70, 55].map((w, i) => (
      <div key={i} style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 3, height: 7, width: `${w}%`, marginBottom: 4 }} />
    ))}
  </div>
);

const FourPillars = () => {
  const [activePillar, setActivePillar] = useState('crew');
  const pillarRefs = useRef({});

  useEffect(() => {
    const onScroll = () => {
      let current = 'crew';
      PILLARS.forEach(({ id }) => {
        const el = pillarRefs.current[id];
        if (el && el.getBoundingClientRect().top <= 120) current = id;
      });
      setActivePillar(current);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollTo = (id) => {
    pillarRefs.current[id]?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section style={{ backgroundColor: '#F8FAFC', borderTop: '2px solid #1E3A5F' }}>
      {/* Full-width dark header */}
      <div style={{ backgroundColor: '#1E3A5F', padding: '52px 40px 48px' }}>
        <p style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(74,144,226,0.9)', marginBottom: 14 }}>THE PRODUCT</p>
        <h2 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 36, textTransform: 'uppercase', color: 'white', lineHeight: 1.0, marginBottom: 12 }}>
          FOUR PILLARS.<br />ONE PLATFORM.
        </h2>
        <p className="mkt-dmsans" style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', maxWidth: 460, lineHeight: 1.65 }}>
          Everything a professional vessel needs to operate — built into a single system your entire crew can use.
        </p>
      </div>

      {/* Two-column sticky sidebar + content */}
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr' }}>
        {/* Sticky sidebar */}
        <div style={{ position: 'sticky', top: 80, height: 'fit-content', backgroundColor: '#F8FAFC', borderRight: '2px solid #1E3A5F', padding: '32px 0' }}>
          <CargoLogoNav activePillar={activePillar} />
          {PILLARS.map(({ id, nav }) => (
            <button
              key={id}
              onClick={() => scrollTo(id)}
              style={{
                display: 'block',
                width: '100%',
                fontFamily: '"Archivo Black", sans-serif',
                fontWeight: 900,
                fontSize: 9,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: activePillar === id ? '#1E3A5F' : '#94A3B8',
                textAlign: 'center',
                padding: '12px 8px',
                borderTop: 'none',
                borderLeft: 'none',
                borderRight: 'none',
                borderBottom: '1px solid #E2E8F0',
                cursor: 'pointer',
                transition: 'color 0.2s',
                background: 'none',
                boxSizing: 'border-box',
              }}
            >
              {nav}
            </button>
          ))}
        </div>

        {/* Scrollable content */}
        <div style={{ overflowY: 'auto' }}>
          {PILLARS.map(({ id, nav, heading, body, modules, mockupLabel }, i) => (
            <div
              key={id}
              data-pillar={id}
              ref={el => { pillarRefs.current[id] = el; }}
              style={{
                padding: '48px 40px',
                borderBottom: i < PILLARS.length - 1 ? '2px solid #E2E8F0' : 'none',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 40,
                alignItems: 'start',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <PetalIcon petal={PETAL_MAP[id]} />
                  <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#4A90E2' }}>{nav}</span>
                </div>
                <h3 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 22, textTransform: 'uppercase', color: '#1E3A5F', lineHeight: 1.05, marginBottom: 10 }}>{heading}</h3>
                <p className="mkt-dmsans" style={{ fontSize: 13, color: '#64748B', lineHeight: 1.65, marginBottom: 16, maxWidth: 360 }}>{body}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {modules.map(m => (
                    <span key={m} className="mkt-archivo" style={{ fontWeight: 700, fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#1E3A5F', padding: '4px 10px', borderRadius: 20, border: '1.5px solid #1E3A5F' }}>{m}</span>
                  ))}
                </div>
              </div>
              <MockupScreen label={mockupLabel} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

/* ─── Why Cargo ──────────────────────────────────────────────────────────── */
const WHY_ROWS = [
  {
    label: 'NOT HOTEL SOFTWARE',
    body: 'Generic hospitality tools were built for hotels and restaurants. Cargo was built around how vessels are actually structured — locations, departments, duty sets, and charter cycles.',
  },
  {
    label: 'NOT FLEET SOFTWARE',
    body: 'Commercial fleet tools manage assets at scale. Cargo manages the day-to-day operational reality of a single vessel — the guests, the crew, the inventory, the trips — all connected.',
  },
  {
    label: 'NOT A SPREADSHEET',
    body: 'Excel and WhatsApp are not systems — they are workarounds. Cargo replaces the patchwork with a single source of truth every department can rely on, from the captain to the chef.',
  },
];

const WhyCargo = () => (
  <section style={{ backgroundColor: '#1E3A5F', padding: '80px 32px' }}>
    <div style={{ maxWidth: 720 }}>
      <p style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 20 }}>
        WHY CARGO
      </p>
      <h2 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 42, textTransform: 'uppercase', color: 'white', lineHeight: 0.97, marginBottom: 28 }}>
        BUILT FOR THE WAY YACHTS ACTUALLY OPERATE.
      </h2>
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        {WHY_ROWS.map(({ label, body }, i) => (
          <div
            key={label}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 20,
              paddingTop: 20,
              paddingBottom: 20,
              borderBottom: i < WHY_ROWS.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none',
            }}
          >
            <span className="mkt-archivo" style={{ fontWeight: 900, fontSize: 11, color: '#4A90E2', letterSpacing: '0.12em', textTransform: 'uppercase', whiteSpace: 'nowrap', paddingTop: 2, minWidth: 140 }}>
              {label}
            </span>
            <span className="mkt-dmsans" style={{ fontSize: 15, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6 }}>
              {body}
            </span>
          </div>
        ))}
      </div>
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
    <FourPillars />
    <WhyCargo />
    <CTABanner />
  </MarketingLayout>
);

export default ProductPage;

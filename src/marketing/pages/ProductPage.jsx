import React, { useState } from 'react';
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

/* ─── Product Hero ───────────────────────────────────────────────────────── */
const HERO_PILLARS = [
  {
    key: 'crew',
    pos: 'tl',
    label: 'CREW OPS',
    heading: 'CREW OPS',
    body: 'From duty sets and scheduling to crew profiles and hours of rest — every person, every shift, every rotation, logged and visible in one place.',
    tags: ['Crew Scheduling', 'Duty Sets', 'Hours of Rest', 'Crew Profiles', 'Activity Feed'],
    translate: 'translate(-8px, -8px)',
  },
  {
    key: 'vessel',
    pos: 'tr',
    label: 'VESSEL OPS',
    heading: 'VESSEL OPS',
    body: "Real-time inventory with interactive location mapping, defect tracking, logs, deliveries, and a full vessel blueprint — your vessel's digital twin.",
    tags: ['Inventory', 'Locations', 'Defect Tracking', 'Vessel Blueprint', 'Logs & Deliveries'],
    translate: 'translate(8px, -8px)',
  },
  {
    key: 'guest',
    pos: 'bl',
    label: 'GUEST OPS',
    heading: 'GUEST OPS',
    body: 'Guest preferences synced to every trip, provisioning linked to profiles, APA tracking, and a full trip lifecycle from planning to post-charter.',
    tags: ['Guest Profiles', 'Trip Management', 'Provisioning', 'APA & Spend', 'Ops Calendar'],
    translate: 'translate(-8px, 8px)',
  },
  {
    key: 'continuity',
    pos: 'br',
    label: 'CONTINUITY',
    heading: 'CONTINUITY',
    body: 'Laundry logs, handover notes, operational history and institutional memory — everything that makes the next crew as good as the last.',
    tags: ['Laundry Logs', 'Handover Notes', 'Operational Logs', 'Knowledge Retention'],
    translate: 'translate(8px, 8px)',
  },
];

const PETAL_PATHS = {
  tl: {
    d: 'M 107.675781 493.1875 C 107.675781 417.746094 138.230469 343.980469 191.574219 290.636719 C 244.917969 237.292969 318.6875 206.738281 394.125 206.738281 L 394.125 423.472656 C 394.125 461.976562 362.914062 493.1875 324.410156 493.1875 Z',
    vb: '107 206 290 290',
  },
  tr: {
    d: 'M 415.863281 206.738281 C 491.304688 206.738281 565.070312 237.292969 618.414062 290.636719 C 671.757812 343.980469 702.3125 417.746094 702.3125 493.1875 L 485.578125 493.1875 C 447.074219 493.1875 415.863281 461.976562 415.863281 423.472656 Z',
    vb: '415 206 290 290',
  },
  bl: {
    d: 'M 394.125 805.253906 C 318.6875 805.253906 244.917969 774.699219 191.574219 721.351562 C 138.230469 668.007812 107.675781 594.242188 107.675781 518.800781 L 324.410156 518.800781 C 362.914062 518.800781 394.125 550.015625 394.125 588.515625 Z',
    vb: '107 518 290 290',
  },
  br: {
    d: 'M 702.3125 518.800781 C 702.3125 594.242188 671.757812 668.007812 618.414062 721.351562 C 565.070312 774.699219 491.304688 805.253906 415.863281 805.253906 L 415.863281 588.515625 C 415.863281 550.015625 447.074219 518.800781 485.578125 518.800781 Z',
    vb: '415 518 290 290',
  },
};

const PETAL_POS = {
  tl: { top: 0, left: 0 },
  tr: { top: 0, right: 0 },
  bl: { bottom: 0, left: 0 },
  br: { bottom: 0, right: 0 },
};

const CrosshairIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
    <line x1="5" y1="0" x2="5" y2="10" stroke="#94A3B8" strokeWidth="1.2" />
    <line x1="0" y1="5" x2="10" y2="5" stroke="#94A3B8" strokeWidth="1.2" />
    <circle cx="5" cy="5" r="1.5" stroke="#94A3B8" strokeWidth="1" fill="none" />
  </svg>
);

const ProductHero = () => {
  const [active, setActive] = useState(null);
  const pillar = active ? HERO_PILLARS.find(p => p.key === active) : null;

  const handleEnter = (key) => setActive(key);
  const handleLeave = () => setActive(null);
  const handleTap = (key) => setActive(prev => prev === key ? null : key);

  return (
    <section style={{ backgroundColor: '#F8FAFC', paddingTop: 135, paddingBottom: 56, borderBottom: '2px solid #1E3A5F', overflow: 'hidden' }}>
      <style>{`
        .product-hero-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 48px;
          align-items: center;
        }
        .product-hero-logo-col { order: 0; }
        .product-hero-text-col { order: 0; }
        .product-hero-logo-box {
          position: relative;
          width: 280px;
          height: 280px;
          margin: 24px auto;
        }
        @media (max-width: 767px) {
          .product-hero-grid {
            grid-template-columns: 1fr;
            gap: 32px;
          }
          .product-hero-logo-col { order: -1; }
          .product-hero-text-col { order: 1; }
          .product-hero-logo-box {
            width: 240px !important;
            height: 240px !important;
          }
        }
      `}</style>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 32px' }}>
        <div className="product-hero-grid">

          {/* LEFT — text */}
          <div className="product-hero-text-col">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ display: 'block', width: 28, height: 2, backgroundColor: '#4A90E2', flexShrink: 0 }} />
              <p style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 13, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#4A90E2', margin: 0 }}>
                The product
              </p>
            </div>
            <h1 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 32, textTransform: 'uppercase', color: '#1E3A5F', lineHeight: 1, marginBottom: 16 }}>
              ONE PLATFORM. END-TO-END VESSEL OPERATIONS.
            </h1>

            {/* Divider */}
            <div style={{ borderTop: '1px solid #E2E8F0', width: '100%', margin: '18px 0' }} />

            {/* Content panel */}
            <div style={{ minHeight: 160 }}>
              {!pillar ? (
                <div>
                  <p className="mkt-dmsans" style={{ fontSize: 14, color: '#64748B', lineHeight: 1.65, marginBottom: 10 }}>
                    Cargo replaces the patchwork of spreadsheets, chat threads, and disconnected apps that most vessel teams rely on today.
                  </p>
                  <p className="mkt-dmsans" style={{ fontSize: 12, color: '#94A3B8', lineHeight: 1.65 }}>
                    No spreadsheets. No WhatsApp threads. One system your entire crew actually uses.
                  </p>
                </div>
              ) : (
                <div>
                  <h2 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 18, textTransform: 'uppercase', color: '#4A90E2', lineHeight: 1, marginBottom: 10 }}>
                    {pillar.heading}
                  </h2>
                  <p className="mkt-dmsans" style={{ fontSize: 15, color: '#64748B', lineHeight: 1.6, marginBottom: 14 }}>
                    {pillar.body}
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {pillar.tags.map(tag => (
                      <span key={tag} className="mkt-archivo" style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#1E3A5F', padding: '6px 14px', borderRadius: 20, border: '1.5px solid #1E3A5F' }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Hint line */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 16 }}>
              <CrosshairIcon />
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: '#94A3B8' }}>
                Hover each segment to explore the four pillars
              </span>
            </div>
          </div>

          {/* RIGHT — interactive logo */}
          <div className="product-hero-logo-col" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <div className="product-hero-logo-box">
              {HERO_PILLARS.map(({ key, pos, label, translate }) => {
                const { d, vb } = PETAL_PATHS[pos];
                const isActive = active === key;
                return (
                  <React.Fragment key={key}>
                    {/* Petal SVG */}
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width={130}
                      height={130}
                      viewBox={vb}
                      style={{
                        position: 'absolute',
                        ...PETAL_POS[pos],
                        cursor: 'pointer',
                        transform: isActive ? translate : 'translate(0, 0)',
                        transition: 'transform 0.4s cubic-bezier(0.34, 1.4, 0.64, 1)',
                      }}
                      onMouseEnter={() => handleEnter(key)}
                      onMouseLeave={handleLeave}
                      onClick={() => handleTap(key)}
                    >
                      <path
                        d={d}
                        fillRule="nonzero"
                        style={{
                          fill: isActive ? '#0d1f35' : '#1E3A5F',
                          transition: 'fill 0.3s ease',
                        }}
                      />
                    </svg>
                  </React.Fragment>
                );
              })}
            </div>
          </div>

        </div>
      </div>
    </section>
  );
};

/* ─── How it works ───────────────────────────────────────────────────────── */
const STEPS = [
  { n: '01', title: 'Set up your vessel', body: 'Add your vessel profile, define locations and storage areas, and configure your crew structure. Cargo maps to how your vessel is actually organised.' },
  { n: '02', title: 'Onboard your crew', body: 'Invite crew by role and email. Each person gets the access level they need — COMMAND, CHIEF, or standard crew. Roles enforce what each person can see and do.' },
  { n: '03', title: 'Run everything from one place', body: 'Inventory, scheduling, trips, guests, defects — all accessible from the same system, all connected to the same vessel context.' },
];

const HowItWorks = () => (
  <section style={{ padding: '72px 32px', maxWidth: 1280, margin: '0 auto' }}>
    <SectionHeading eyebrow="How it works" headline="Up and running in days, not months" />
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
    <ProductHero />
    <HowItWorks />
    <CTABanner />
  </MarketingLayout>
);

export default ProductPage;

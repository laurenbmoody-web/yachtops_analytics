import React from 'react';
import { Link } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';

/* ─── Role cards ─────────────────────────────────────────────────────────── */
const ROLES = [
  {
    n: '01', title: 'Captain', tag: 'COMMAND',
    headline: 'Full operational oversight — wherever you are',
    points: [
      'Complete visibility across all crew, trips, and vessel systems',
      'Approve defect close-outs and maintenance decisions',
      'Trip planning and itinerary management with full context',
      'Crew rotation and duty-set oversight',
      'Vessel-wide activity feed to stay on top of everything',
    ],
  },
  {
    n: '02', title: 'Chief Stewardess', tag: 'CHIEF',
    headline: 'Guest experience managed, not guessed',
    points: [
      'Complete guest preference profiles for every charter',
      'Laundry scheduling and history without the paper trail',
      'Cabin and guest allocation per trip',
      'Stew inventory sections with accurate provisioning data',
      'Activity and job assignment for your interior team',
    ],
  },
  {
    n: '03', title: 'Chief Engineer', tag: 'CHIEF',
    headline: 'Every defect tracked, nothing slips through',
    points: [
      'Log, assign, and close defects with a full audit trail',
      'Vessel blueprint view for spatial context on every issue',
      'Engine room and mechanical inventory sections',
      'Maintenance history tied to vessel areas and systems',
      'Link defects to trips and crew for accountability',
    ],
  },
  {
    n: '04', title: 'Bosun', tag: 'CREW',
    headline: 'Deck ops organised without the back-and-forth',
    points: [
      'Deck and exterior inventory locations always up to date',
      'Job assignments and team task lists',
      'Defect reporting tied to deck areas on the blueprint',
      'Duty schedules and rotation visibility',
      'Logs and delivery records for provisions and supplies',
    ],
  },
  {
    n: '05', title: 'Purser / Manager', tag: 'COMMAND',
    headline: 'The administrative layer, finally under control',
    points: [
      'Guest management and preference directory',
      'Charter trip history and guest manifests',
      'Crew profile management and invite system',
      'Inventory analytics and provisioning reports',
      'Activity feed for full operational visibility',
    ],
  },
];

/* ─── Vessel types ───────────────────────────────────────────────────────── */
const VESSEL_TYPES = [
  { n: '01', type: 'Superyacht', sub: '30m+', body: 'Large professional crews need role-based access, structured inventory, and coordinated operations across departments. Cargo is built for exactly this complexity.' },
  { n: '02', type: 'Explorer / Expedition', sub: 'Long-range', body: 'Remote operations demand reliable access to provisioning data, maintenance history, and crew schedules without connectivity dependencies.' },
  { n: '03', type: 'Charter Fleet', sub: 'Multi-vessel', body: 'Manage guest preferences, trip histories, and crew across multiple vessels from a single platform with per-vessel data isolation.' },
  { n: '04', type: 'Private Yacht', sub: 'Owner-operated', body: 'A lean crew still deserves a proper system. Cargo scales down without removing capability — you only use what you need.' },
];

/* ─── Page ───────────────────────────────────────────────────────────────── */
const WhoItsForPage = () => (
  <MarketingLayout>
    {/* Hero */}
    <section style={{ paddingTop: 96, paddingBottom: 56, borderBottom: '1px solid #E2E8F0', textAlign: 'center' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 32px' }}>
        <p className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#4A90E2', marginBottom: 10 }}>Who it's for</p>
        <h1 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 38, textTransform: 'uppercase', color: '#1E3A5F', lineHeight: 1.05, marginBottom: 14 }}>
          Built for everyone who runs the vessel
        </h1>
        <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 15, color: '#64748B', maxWidth: 520, margin: '0 auto', lineHeight: 1.7 }}>
          Cargo gives each crew member exactly what they need. Role-based access means the captain sees everything, and crew see their world.
        </p>
      </div>
    </section>

    {/* Role cards */}
    <section style={{ padding: '72px 32px', borderBottom: '1px solid #E2E8F0' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {ROLES.map(({ n, title, tag, headline, points }) => (
            <div key={n} className="bg-white rounded-xl p-6" style={{ border: '2px solid #1E3A5F' }}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="mkt-archivo" style={{ fontWeight: 900, fontSize: 22, color: '#4A90E2', lineHeight: 1, marginBottom: 4 }}>{n}</p>
                  <h3 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1E3A5F' }}>{title}</h3>
                  <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 12, color: '#64748B', marginTop: 2 }}>{headline}</p>
                </div>
                <span className="mkt-archivo flex-shrink-0 ml-3" style={{ fontWeight: 900, fontSize: 9, letterSpacing: '0.08em', color: '#4A90E2', backgroundColor: 'rgba(74,144,226,0.1)', borderRadius: 50, padding: '4px 8px' }}>
                  {tag}
                </span>
              </div>
              <ul style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {points.map(p => (
                  <li key={p} className="flex items-start gap-2.5">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#4A90E2' }} />
                    <span className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 12, color: '#64748B', lineHeight: 1.5 }}>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* Vessel types */}
    <section style={{ padding: '72px 32px', backgroundColor: 'white', borderBottom: '1px solid #E2E8F0' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div className="text-center" style={{ marginBottom: 48 }}>
          <p className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#4A90E2', marginBottom: 10 }}>Vessel types</p>
          <h2 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 28, color: '#1E3A5F', lineHeight: 1.15, marginBottom: 10 }}>Scales to the size of your operation</h2>
          <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: '#64748B', maxWidth: 440, margin: '0 auto', lineHeight: 1.65 }}>
            From private yachts to large charter fleets, Cargo adapts to the complexity you bring to it.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {VESSEL_TYPES.map(({ n, type, sub, body }) => (
            <div key={n} className="bg-[#F8FAFC] rounded-xl p-6" style={{ border: '2px solid #1E3A5F' }}>
              <p className="mkt-archivo" style={{ fontWeight: 900, fontSize: 22, color: '#4A90E2', lineHeight: 1, marginBottom: 6 }}>{n}</p>
              <h3 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1E3A5F', marginBottom: 2 }}>{type}</h3>
              <p className="mkt-dmsans" style={{ fontWeight: 500, fontSize: 11, color: '#4A90E2', marginBottom: 8 }}>{sub}</p>
              <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 12, color: '#64748B', lineHeight: 1.6 }}>{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* CTA */}
    <section style={{ padding: '72px 32px' }}>
      <div className="rounded-2xl text-center" style={{ maxWidth: 860, margin: '0 auto', backgroundColor: '#1E3A5F', padding: '56px 40px' }}>
        <p className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(74,144,226,0.8)', marginBottom: 12 }}>Get started</p>
        <h2 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 26, color: 'white', lineHeight: 1.15, marginBottom: 10 }}>Sound like your vessel?</h2>
        <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: 'rgba(255,255,255,0.55)', maxWidth: 400, margin: '0 auto 28px', lineHeight: 1.65 }}>
          Book a demo and show us your setup — we'll walk through how Cargo fits your crew structure.
        </p>
        <Link to="/contact" className="mkt-archivo transition-colors duration-150"
          style={{ fontWeight: 900, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#1E3A5F', backgroundColor: 'white', borderRadius: 50, padding: '10px 24px', textDecoration: 'none', display: 'inline-block' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F8FAFC')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'white')}
        >Book a Demo</Link>
      </div>
    </section>
  </MarketingLayout>
);

export default WhoItsForPage;

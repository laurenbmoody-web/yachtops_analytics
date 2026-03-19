import React from 'react';
import { Link } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';

const VALUES = [
  { n: '01', title: 'Vessel-first thinking', body: "Every feature decision starts with one question: does this match how vessels actually operate? If a workflow doesn't reflect reality on deck, it doesn't ship." },
  { n: '02', title: 'Respect for crew time', body: 'Crew are busy. The system should stay out of the way and surface what matters. Dense dashboards and feature bloat are the enemy.' },
  { n: '03', title: 'Depth over breadth', body: "We'd rather do ten things exceptionally well than fifty things poorly. Every module in Cargo is built to handle the edge cases real operations throw at it." },
  { n: '04', title: 'Information stays on the vessel', body: 'Guest preferences, inventory data, and crew details are sensitive. We build with data ownership and privacy in mind at every layer.' },
];

const AboutPage = () => (
  <MarketingLayout>
    {/* Hero */}
    <section style={{ paddingTop: 96, paddingBottom: 56, borderBottom: '1px solid #E2E8F0', textAlign: 'center' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 32px' }}>
        <p className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#4A90E2', marginBottom: 10 }}>About</p>
        <h1 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 38, textTransform: 'uppercase', color: '#1E3A5F', lineHeight: 1.05, marginBottom: 14 }}>
          Built out of frustration with how yachts are run
        </h1>
        <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 15, color: '#64748B', maxWidth: 520, margin: '0 auto', lineHeight: 1.7 }}>
          Cargo started from a simple observation: professional vessel operations are genuinely complex, but almost no software takes them seriously.
        </p>
      </div>
    </section>

    {/* Origin story */}
    <section style={{ padding: '72px 32px', borderBottom: '1px solid #E2E8F0' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div className="bg-white rounded-xl p-10" style={{ border: '2px solid #1E3A5F', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {[
            "Most yacht operations tools are one of two things: consumer apps repurposed for professional use, or enterprise fleet-management software scaled down and stripped of context. Neither works for a 50m vessel with a crew of 12 running back-to-back charters.",
            "The spreadsheets are relentless. There's one for inventory, one for crew scheduling, one for guest preferences, another for defects. They live on different laptops, go out of sync constantly, and disappear with rotating crew. Critical information becomes institutional knowledge instead of documented fact.",
            "Cargo is our answer to that problem. A single system designed around the actual workflows of yacht operations — the way departments interact, the way information flows from charter to charter, the way crew accountability actually works.",
          ].map((text, i) => (
            <p key={i} className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: '#64748B', lineHeight: 1.75 }}>{text}</p>
          ))}
          <div style={{ paddingTop: 16, borderTop: '1px solid #E2E8F0' }}>
            <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 13, color: '#64748B', fontStyle: 'italic', lineHeight: 1.65 }}>
              "We didn't want to build another tool that crew have to work around. We wanted to build the thing they'd actually reach for."
            </p>
            <p className="mkt-dmsans" style={{ fontWeight: 500, fontSize: 12, color: '#94A3B8', marginTop: 6 }}>— The Cargo team</p>
          </div>
        </div>
      </div>
    </section>

    {/* Mission + values */}
    <section style={{ padding: '72px 32px', backgroundColor: 'white', borderBottom: '1px solid #E2E8F0' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div className="grid lg:grid-cols-2 gap-16 items-start">
          <div>
            <p className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#4A90E2', marginBottom: 10 }}>Mission</p>
            <h2 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 28, color: '#1E3A5F', lineHeight: 1.15, marginBottom: 16 }}>
              Make professional vessel operations genuinely manageable
            </h2>
            <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: '#64748B', lineHeight: 1.75, marginBottom: 14 }}>
              We're building the system that vessel operations teams actually deserve — one where the software does the heavy lifting, crew have the context they need, and nothing falls through the cracks between departments.
            </p>
            <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: '#64748B', lineHeight: 1.75 }}>
              Not a MVP. Not a pivot. A focused, deliberate platform for people who take their work seriously.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {VALUES.map(({ n, title, body }) => (
              <div key={n} className="bg-[#F8FAFC] rounded-xl p-5 flex gap-4" style={{ border: '2px solid #1E3A5F' }}>
                <p className="mkt-archivo flex-shrink-0" style={{ fontWeight: 900, fontSize: 18, color: '#4A90E2', lineHeight: 1, marginTop: 2 }}>{n}</p>
                <div>
                  <h4 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1E3A5F', marginBottom: 5 }}>{title}</h4>
                  <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 12, color: '#64748B', lineHeight: 1.6 }}>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>

    {/* CTA */}
    <section style={{ padding: '72px 32px' }}>
      <div className="text-center" style={{ maxWidth: 560, margin: '0 auto' }}>
        <p className="mkt-archivo" style={{ fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#4A90E2', marginBottom: 10 }}>Get involved</p>
        <h2 className="mkt-archivo" style={{ fontWeight: 900, fontSize: 26, color: '#1E3A5F', lineHeight: 1.15, marginBottom: 10 }}>Want to be part of it?</h2>
        <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: '#64748B', marginBottom: 28, lineHeight: 1.65 }}>
          We're building with a small group of early operators. If you want to shape how Cargo develops, now's the time.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link to="/contact" className="mkt-archivo transition-colors duration-150"
            style={{ fontWeight: 900, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'white', backgroundColor: '#1E3A5F', borderRadius: 50, padding: '10px 22px', textDecoration: 'none' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#141D2E')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#1E3A5F')}
          >Book a Demo</Link>
          <Link to="/contact" className="mkt-archivo transition-colors duration-150"
            style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#1E3A5F', border: '2px solid #1E3A5F', borderRadius: 50, padding: '8px 22px', textDecoration: 'none' }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#1E3A5F'; e.currentTarget.style.color = 'white'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#1E3A5F'; }}
          >Join the Waitlist</Link>
        </div>
      </div>
    </section>
  </MarketingLayout>
);

export default AboutPage;

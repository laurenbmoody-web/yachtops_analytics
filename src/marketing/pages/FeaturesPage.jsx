import React from 'react';
import { Link } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';

/* ─── Feature Section ─────────────────────────────────────────────────────── */
const FeatureSection = ({ eyebrow, heading, body, tags, odd }) => (
  <section style={{
    padding: '80px 0',
    backgroundColor: odd ? '#F8FAFC' : 'white',
    borderBottom: '2px solid #1E3A5F',
  }}>
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 48px' }}>
      {/* Top: two-column text row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'start', marginBottom: 48 }}>
        {/* Left: eyebrow + heading + body */}
        <div>
          <p style={{
            fontFamily: 'Inter, sans-serif',
            fontWeight: 600,
            fontSize: 10,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: '#4A90E2',
            margin: '0 0 10px',
          }}>
            {eyebrow}
          </p>
          <h2 style={{
            fontFamily: '"Archivo Black", sans-serif',
            fontWeight: 900,
            fontSize: 32,
            color: '#1E3A5F',
            lineHeight: 1.1,
            margin: '0 0 14px',
          }}>
            {heading}
          </h2>
          <p style={{
            fontFamily: '"DM Sans", sans-serif',
            fontSize: 16,
            color: '#64748B',
            lineHeight: 1.65,
            margin: 0,
          }}>
            {body}
          </p>
        </div>
        {/* Right: feature tags */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignContent: 'flex-start', paddingTop: 4 }}>
          {tags.map(tag => (
            <span key={tag} style={{
              fontFamily: '"Archivo Black", sans-serif',
              fontWeight: 700,
              fontSize: 8,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: '#1E3A5F',
              padding: '4px 11px',
              borderRadius: 20,
              border: '1.5px solid #1E3A5F',
              display: 'inline-block',
            }}>
              {tag}
            </span>
          ))}
        </div>
      </div>
      {/* Bottom: screen mockup placeholder */}
      <div style={{
        backgroundColor: '#0d1a2e',
        height: 400,
        borderRadius: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(255,255,255,0.2)' }}>
          Screen mockup coming
        </span>
      </div>
    </div>
  </section>
);

/* ─── Page ───────────────────────────────────────────────────────────────── */
const FeaturesPage = () => (
  <MarketingLayout>
    {/* Hero */}
    <section style={{ backgroundColor: '#1E3A5F', padding: '80px 32px', textAlign: 'center' }}>
      <p style={{
        fontFamily: 'Inter, sans-serif',
        fontWeight: 600,
        fontSize: 10,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.4)',
        margin: '0 0 16px',
      }}>
        Features
      </p>
      <h1 style={{
        fontFamily: '"Archivo Black", sans-serif',
        fontWeight: 900,
        fontSize: 52,
        color: 'white',
        textTransform: 'uppercase',
        lineHeight: 0.95,
        margin: '0 0 24px',
      }}>
        EVERY FEATURE YOUR CREW NEEDS.
      </h1>
      <p style={{
        fontFamily: '"DM Sans", sans-serif',
        fontSize: 16,
        color: 'rgba(255,255,255,0.5)',
        maxWidth: 520,
        margin: '0 auto',
        lineHeight: 1.65,
      }}>
        Cargo is built deep, not wide. Each module has the features real vessel teams need — not watered-down versions of generic software.
      </p>
    </section>

    {/* Section 1: Crew & Scheduling */}
    <FeatureSection
      odd={true}
      eyebrow="Crew & Scheduling"
      heading="Your crew, organised and accountable."
      body="Duty sets, rotation planning and job lists — all connected. Every crew member knows what they're doing and when, without a spreadsheet in sight."
      tags={['Duty Sets', 'Rotation Calendar', 'Auto Rotate', 'Team Jobs', 'Crew Profiles', 'Export Schedule']}
    />

    {/* Section 2: Guest & Preferences */}
    <FeatureSection
      odd={false}
      eyebrow="Guest & Preferences"
      heading="Know your guests before they board."
      body="A 10-step preference assistant captures everything — allergies, dining style, service preferences, personality — so every trip starts with the full picture."
      tags={['Guest Profiles', 'Preference Assistant', 'Allergies & Medical', 'Food & Drink', 'Service Style', 'Trip History']}
    />

    {/* Section 3: Inventory */}
    <FeatureSection
      odd={true}
      eyebrow="Inventory"
      heading="Know exactly what you have and where."
      body="Department folders, location hierarchy and real-time item tracking. From the medical cabinet to the galley stores — every item accounted for, every expiry date tracked."
      tags={['Department Folders', 'Location Hierarchy', 'Bulk Import', 'Expiry Tracking', 'CARGO Item IDs', 'Export']}
    />

    {/* Section 4: Jobs & Tasks */}
    <FeatureSection
      odd={false}
      eyebrow="Jobs & Tasks"
      heading="Every task assigned, nothing lost."
      body="Department job lists, daily task boards and recurring templates. Every task has an owner, a due date and a status the whole team can see."
      tags={['Open Jobs', 'Dailies Board', 'Custom Boards', 'Department Filter', 'Task Notes', 'Manage Rotation']}
    />

    {/* CTA */}
    <section style={{ backgroundColor: '#1E3A5F', padding: '80px 32px', textAlign: 'center' }}>
      <p style={{
        fontFamily: 'Inter, sans-serif',
        fontWeight: 600,
        fontSize: 10,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.35)',
        margin: '0 0 16px',
      }}>
        Want to see these in action?
      </p>
      <h2 style={{
        fontFamily: '"Archivo Black", sans-serif',
        fontWeight: 900,
        fontSize: 40,
        color: 'white',
        textTransform: 'uppercase',
        lineHeight: 1.05,
        margin: '0 auto 18px',
        maxWidth: 720,
      }}>
        BOOK A DEMO AND WE'LL WALK THROUGH EVERY MODULE WITH YOU.
      </h2>
      <p style={{
        fontFamily: '"DM Sans", sans-serif',
        fontSize: 15,
        color: 'rgba(255,255,255,0.5)',
        margin: '0 auto 32px',
        maxWidth: 400,
      }}>
        30 minutes. Your vessel in mind. No generic walkthroughs.
      </p>
      <Link
        to="/contact"
        style={{
          display: 'inline-block',
          fontFamily: 'Inter, sans-serif',
          fontWeight: 700,
          fontSize: 14,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: '#1E3A5F',
          backgroundColor: 'white',
          borderRadius: 50,
          padding: '14px 32px',
          textDecoration: 'none',
        }}
      >
        BOOK A DEMO
      </Link>
    </section>
  </MarketingLayout>
);

export default FeaturesPage;

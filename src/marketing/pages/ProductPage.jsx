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
  const gs = (p) => ({
    transform: ap === p ? PETAL_TRANSFORMS[p] : 'translate(0, 0)',
    transformOrigin: PETAL_ORIGINS[p],
    transition: 'transform 0.4s cubic-bezier(0.34, 1.4, 0.64, 1)',
  });
  const f = (p) => ({ fill: ap === p ? '#0d1f35' : '#1E3A5F', transition: 'fill 0.3s ease' });
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="64" viewBox="0 0 810 1012.49997" style={{ display: 'block', margin: '0 auto 16px' }}>
      <defs>
        <clipPath id="fp-092bb80a56"><path d="M 415.863281 206.738281 L 703 206.738281 L 703 493.1875 L 415.863281 493.1875 Z M 415.863281 206.738281 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-b9daef7671"><path d="M 415.863281 206.738281 C 491.304688 206.738281 565.070312 237.292969 618.414062 290.636719 C 671.757812 343.980469 702.3125 417.746094 702.3125 493.1875 L 485.578125 493.1875 C 447.074219 493.1875 415.863281 461.976562 415.863281 423.472656 Z M 415.863281 206.738281 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-e4229fbefe"><path d="M 0.863281 0.738281 L 287.332031 0.738281 L 287.332031 287.1875 L 0.863281 287.1875 Z M 0.863281 0.738281 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-eedd6c3e85"><path d="M 0.863281 0.738281 C 76.304688 0.738281 150.070312 31.292969 203.414062 84.636719 C 256.757812 137.980469 287.3125 211.746094 287.3125 287.1875 L 70.578125 287.1875 C 32.074219 287.1875 0.863281 255.976562 0.863281 217.472656 Z M 0.863281 0.738281 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-42c3f660d6"><rect x="0" y="0" width="288" height="288"/></clipPath>
        <clipPath id="fp-b052901fff"><path d="M 437.652344 237.359375 L 672 237.359375 L 672 471.40625 L 437.652344 471.40625 Z M 437.652344 237.359375 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-9bace9cf65"><path d="M 437.652344 237.359375 C 499.292969 237.359375 559.566406 262.324219 603.152344 305.910156 C 646.738281 349.496094 671.703125 409.769531 671.703125 471.40625 L 496.875 471.40625 C 481.167969 471.40625 466.105469 465.167969 455 454.0625 C 443.894531 442.957031 437.652344 427.894531 437.652344 412.1875 Z M 437.652344 237.359375 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-96f417a92e"><path d="M 0.652344 0.359375 L 234.867188 0.359375 L 234.867188 234.40625 L 0.652344 234.40625 Z M 0.652344 0.359375 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-b3d0303b0f"><path d="M 0.652344 0.359375 C 62.292969 0.359375 122.566406 25.324219 166.152344 68.910156 C 209.738281 112.496094 234.703125 172.769531 234.703125 234.40625 L 59.875 234.40625 C 44.167969 234.40625 29.105469 228.167969 18 217.0625 C 6.894531 205.957031 0.652344 190.894531 0.652344 175.1875 Z M 0.652344 0.359375 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-074eab4e22"><rect x="0" y="0" width="235" height="235"/></clipPath>
        <clipPath id="fp-1ff2265b49"><path d="M 415.863281 518.800781 L 702.3125 518.800781 L 702.3125 806 L 415.863281 806 Z M 415.863281 518.800781 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-b2c9aa30ff"><path d="M 702.3125 518.800781 C 702.3125 594.242188 671.757812 668.007812 618.414062 721.351562 C 565.070312 774.699219 491.304688 805.253906 415.863281 805.253906 L 415.863281 588.515625 C 415.863281 550.015625 447.074219 518.800781 485.578125 518.800781 Z M 702.3125 518.800781 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-65f62a4c86"><path d="M 0.863281 0.800781 L 287.3125 0.800781 L 287.3125 287.28125 L 0.863281 287.28125 Z M 0.863281 0.800781 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-fff57ac81a"><path d="M 287.3125 0.800781 C 287.3125 76.242188 256.757812 150.007812 203.414062 203.351562 C 150.070312 256.699219 76.304688 287.253906 0.863281 287.253906 L 0.863281 70.515625 C 0.863281 32.015625 32.074219 0.800781 70.578125 0.800781 Z M 287.3125 0.800781 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-5fe927a0ef"><rect x="0" y="0" width="288" height="288"/></clipPath>
        <clipPath id="fp-deef7b8998"><path d="M 437.652344 540.59375 L 671.703125 540.59375 L 671.703125 775 L 437.652344 775 Z M 437.652344 540.59375 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-5dfa02cfe6"><path d="M 671.703125 540.59375 C 671.703125 602.230469 646.738281 662.503906 603.152344 706.089844 C 559.566406 749.675781 499.292969 774.640625 437.652344 774.640625 L 437.652344 599.8125 C 437.652344 584.105469 443.894531 569.042969 455 557.9375 C 466.105469 546.832031 481.167969 540.59375 496.875 540.59375 Z M 671.703125 540.59375 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-fbb700d2bb"><path d="M 0.652344 0.59375 L 234.703125 0.59375 L 234.703125 234.816406 L 0.652344 234.816406 Z M 0.652344 0.59375 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-d50341778a"><path d="M 234.703125 0.59375 C 234.703125 62.230469 209.738281 122.503906 166.152344 166.089844 C 122.566406 209.675781 62.292969 234.640625 0.652344 234.640625 L 0.652344 59.8125 C 0.652344 44.105469 6.894531 29.042969 18 17.9375 C 29.105469 6.832031 44.167969 0.59375 59.875 0.59375 Z M 234.703125 0.59375 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-ca6abdb62d"><rect x="0" y="0" width="235" height="235"/></clipPath>
        <clipPath id="fp-853215f669"><path d="M 107.675781 206 L 394.125 206 L 394.125 493.1875 L 107.675781 493.1875 Z M 107.675781 206 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-678e0f0a91"><path d="M 107.675781 493.1875 C 107.675781 417.746094 138.230469 343.980469 191.574219 290.636719 C 244.917969 237.292969 318.6875 206.738281 394.125 206.738281 L 394.125 423.472656 C 394.125 461.976562 362.914062 493.1875 324.410156 493.1875 Z M 107.675781 493.1875 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-8648ac4439"><path d="M 0.675781 0.539062 L 287.125 0.539062 L 287.125 287.1875 L 0.675781 287.1875 Z M 0.675781 0.539062 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-6db67cbd06"><path d="M 0.675781 287.1875 C 0.675781 211.746094 31.230469 137.980469 84.574219 84.636719 C 137.917969 31.292969 211.6875 0.738281 287.125 0.738281 L 287.125 217.472656 C 287.125 255.976562 255.914062 287.1875 217.410156 287.1875 Z M 0.675781 287.1875 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-9f30f060af"><rect x="0" y="0" width="288" height="288"/></clipPath>
        <clipPath id="fp-28ac76b0ec"><path d="M 138.296875 237 L 372.34375 237 L 372.34375 471.40625 L 138.296875 471.40625 Z M 138.296875 237 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-6507a87dd6"><path d="M 138.296875 471.40625 C 138.296875 409.769531 163.261719 349.496094 206.847656 305.910156 C 250.433594 262.324219 310.707031 237.359375 372.34375 237.359375 L 372.34375 412.1875 C 372.34375 427.894531 366.105469 442.957031 355 454.0625 C 343.894531 465.167969 328.832031 471.40625 313.125 471.40625 Z M 138.296875 471.40625 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-ead5941449"><path d="M 0.296875 0.242188 L 234.34375 0.242188 L 234.34375 234.40625 L 0.296875 234.40625 Z M 0.296875 0.242188 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-95234a408d"><path d="M 0.296875 234.40625 C 0.296875 172.769531 25.261719 112.496094 68.847656 68.910156 C 112.433594 25.324219 172.707031 0.359375 234.34375 0.359375 L 234.34375 175.1875 C 234.34375 190.894531 228.105469 205.957031 217 217.0625 C 205.894531 228.167969 190.832031 234.40625 175.125 234.40625 Z M 0.296875 234.40625 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-394cc166b1"><rect x="0" y="0" width="235" height="235"/></clipPath>
        <clipPath id="fp-872b4a0c78"><path d="M 107 518.800781 L 394.125 518.800781 L 394.125 805.253906 L 107 805.253906 Z M 107 518.800781 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-ef07cff476"><path d="M 394.125 805.253906 C 318.6875 805.253906 244.917969 774.699219 191.574219 721.351562 C 138.230469 668.007812 107.675781 594.242188 107.675781 518.800781 L 324.410156 518.800781 C 362.914062 518.800781 394.125 550.015625 394.125 588.515625 Z M 394.125 805.253906 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-2279a4ef54"><path d="M 0.667969 0.800781 L 287.125 0.800781 L 287.125 287.253906 L 0.667969 287.253906 Z M 0.667969 0.800781 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-3f2c0a3f37"><path d="M 287.125 287.253906 C 211.6875 287.253906 137.917969 256.699219 84.574219 203.351562 C 31.230469 150.007812 0.675781 76.242188 0.675781 0.800781 L 217.410156 0.800781 C 255.914062 0.800781 287.125 32.015625 287.125 70.515625 Z M 287.125 287.253906 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-d5ec259c01"><rect x="0" y="0" width="288" height="288"/></clipPath>
        <clipPath id="fp-7b1e203bef"><path d="M 138 540.59375 L 372.34375 540.59375 L 372.34375 774.640625 L 138 774.640625 Z M 138 540.59375 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-bbcef810fd"><path d="M 372.34375 774.640625 C 310.707031 774.640625 250.433594 749.675781 206.847656 706.089844 C 163.261719 662.503906 138.296875 602.230469 138.296875 540.59375 L 313.125 540.59375 C 328.832031 540.59375 343.894531 546.832031 355 557.9375 C 366.105469 569.042969 372.34375 584.105469 372.34375 599.8125 Z M 372.34375 774.640625 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-66c5d53af4"><path d="M 0.132812 0.59375 L 234.34375 0.59375 L 234.34375 234.640625 L 0.132812 234.640625 Z M 0.132812 0.59375 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-a30cf9929a"><path d="M 234.34375 234.640625 C 172.707031 234.640625 112.433594 209.675781 68.847656 166.089844 C 25.261719 122.503906 0.296875 62.230469 0.296875 0.59375 L 175.125 0.59375 C 190.832031 0.59375 205.894531 6.832031 217 17.9375 C 228.105469 29.042969 234.34375 44.105469 234.34375 59.8125 Z M 234.34375 234.640625 " clipRule="nonzero"/></clipPath>
        <clipPath id="fp-fe48e23e37"><rect x="0" y="0" width="235" height="235"/></clipPath>
      </defs>

      {/* petal-tl — crew */}
      <g id="petal-tl" style={gs('tl')}>
        <g clipPath="url(#fp-853215f669)"><g clipPath="url(#fp-678e0f0a91)"><g transform="matrix(1,0,0,1,107,206)"><g clipPath="url(#fp-9f30f060af)"><g clipPath="url(#fp-8648ac4439)"><g clipPath="url(#fp-6db67cbd06)"><path style={f('tl')} fillRule="nonzero" d="M 0.675781 0.738281 L 287.125 0.738281 L 287.125 287.1875 L 0.675781 287.1875 Z"/></g></g></g></g></g></g>
        <g clipPath="url(#fp-28ac76b0ec)"><g clipPath="url(#fp-6507a87dd6)"><g transform="matrix(1,0,0,1,138,237)"><g clipPath="url(#fp-394cc166b1)"><g clipPath="url(#fp-ead5941449)"><g clipPath="url(#fp-95234a408d)"><path style={f('tl')} fillRule="nonzero" d="M 0.296875 0.359375 L 234.34375 0.359375 L 234.34375 234.40625 L 0.296875 234.40625 Z"/></g></g></g></g></g></g>
      </g>

      {/* petal-tr — vessel */}
      <g id="petal-tr" style={gs('tr')}>
        <g clipPath="url(#fp-092bb80a56)"><g clipPath="url(#fp-b9daef7671)"><g transform="matrix(1,0,0,1,415,206)"><g clipPath="url(#fp-42c3f660d6)"><g clipPath="url(#fp-e4229fbefe)"><g clipPath="url(#fp-eedd6c3e85)"><path style={f('tr')} fillRule="nonzero" d="M 287.3125 0.738281 L 287.3125 287.1875 L 0.863281 287.1875 L 0.863281 0.738281 Z"/></g></g></g></g></g></g>
        <g clipPath="url(#fp-b052901fff)"><g clipPath="url(#fp-9bace9cf65)"><g transform="matrix(1,0,0,1,437,237)"><g clipPath="url(#fp-074eab4e22)"><g clipPath="url(#fp-96f417a92e)"><g clipPath="url(#fp-b3d0303b0f)"><path style={f('tr')} fillRule="nonzero" d="M 234.703125 0.359375 L 234.703125 234.40625 L 0.652344 234.40625 L 0.652344 0.359375 Z"/></g></g></g></g></g></g>
      </g>

      {/* petal-bl — guest */}
      <g id="petal-bl" style={gs('bl')}>
        <g clipPath="url(#fp-872b4a0c78)"><g clipPath="url(#fp-ef07cff476)"><g transform="matrix(1,0,0,1,107,518)"><g clipPath="url(#fp-d5ec259c01)"><g clipPath="url(#fp-2279a4ef54)"><g clipPath="url(#fp-3f2c0a3f37)"><path style={f('bl')} fillRule="nonzero" d="M 0.675781 287.253906 L 0.675781 0.800781 L 287.125 0.800781 L 287.125 287.253906 Z"/></g></g></g></g></g></g>
        <g clipPath="url(#fp-7b1e203bef)"><g clipPath="url(#fp-bbcef810fd)"><g transform="matrix(1,0,0,1,138,540)"><g clipPath="url(#fp-fe48e23e37)"><g clipPath="url(#fp-66c5d53af4)"><g clipPath="url(#fp-a30cf9929a)"><path style={f('bl')} fillRule="nonzero" d="M 0.296875 234.640625 L 0.296875 0.59375 L 234.34375 0.59375 L 234.34375 234.640625 Z"/></g></g></g></g></g></g>
      </g>

      {/* petal-br — continuity */}
      <g id="petal-br" style={gs('br')}>
        <g clipPath="url(#fp-1ff2265b49)"><g clipPath="url(#fp-b2c9aa30ff)"><g transform="matrix(1,0,0,1,415,518)"><g clipPath="url(#fp-5fe927a0ef)"><g clipPath="url(#fp-65f62a4c86)"><g clipPath="url(#fp-fff57ac81a)"><path style={f('br')} fillRule="nonzero" d="M 287.3125 287.253906 L 0.863281 287.253906 L 0.863281 0.800781 L 287.3125 0.800781 Z"/></g></g></g></g></g></g>
        <g clipPath="url(#fp-deef7b8998)"><g clipPath="url(#fp-5dfa02cfe6)"><g transform="matrix(1,0,0,1,437,540)"><g clipPath="url(#fp-ca6abdb62d)"><g clipPath="url(#fp-fbb700d2bb)"><g clipPath="url(#fp-d50341778a)"><path style={f('br')} fillRule="nonzero" d="M 234.703125 234.640625 L 0.652344 234.640625 L 0.652344 0.59375 L 234.703125 0.59375 Z"/></g></g></g></g></g></g>
      </g>
    </svg>
  );
};

const PetalIcon = ({ petal }) => {
  const viewBoxes = { tl: '0 0 14 14', tr: '14 0 14 14', bl: '0 14 14 14', br: '14 14 14 14' };
  return (
    <svg width="16" height="16" viewBox={viewBoxes[petal]} fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="28" height="28" rx="5" fill="#4A90E2" />
      <path d="M20 9a7 7 0 1 0 0 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none" />
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

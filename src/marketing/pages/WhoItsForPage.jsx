import React from 'react';
import { Link } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';

/* ─── Role cards ─────────────────────────────────────────────────────────── */
const roles = [
  {
    title: 'Captain',
    color: 'text-[#00A8CC]',
    border: 'border-[#00A8CC]/20',
    bg: 'bg-[#00A8CC]/10',
    dot: 'bg-[#00A8CC]',
    tag: 'COMMAND',
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
    title: 'Chief Stewardess',
    color: 'text-violet-400',
    border: 'border-violet-400/20',
    bg: 'bg-violet-400/10',
    dot: 'bg-violet-400',
    tag: 'CHIEF',
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
    title: 'Chief Engineer',
    color: 'text-amber-400',
    border: 'border-amber-400/20',
    bg: 'bg-amber-400/10',
    dot: 'bg-amber-400',
    tag: 'CHIEF',
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
    title: 'Bosun',
    color: 'text-emerald-400',
    border: 'border-emerald-400/20',
    bg: 'bg-emerald-400/10',
    dot: 'bg-emerald-400',
    tag: 'CREW',
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
    title: 'Purser / Manager',
    color: 'text-sky-400',
    border: 'border-sky-400/20',
    bg: 'bg-sky-400/10',
    dot: 'bg-sky-400',
    tag: 'COMMAND',
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

/* ─── Vessel type cards ──────────────────────────────────────────────────── */
const vesselTypes = [
  {
    type: 'Superyacht',
    sub: '30m+',
    body: 'Large professional crews need role-based access, structured inventory, and coordinated operations across departments. Cargo is built for exactly this complexity.',
  },
  {
    type: 'Explorer / Expedition',
    sub: 'Long-range',
    body: 'Remote operations demand reliable access to provisioning data, maintenance history, and crew schedules without connectivity dependencies.',
  },
  {
    type: 'Charter Fleet',
    sub: 'Multi-vessel',
    body: 'Manage guest preferences, trip histories, and crew across multiple vessels from a single platform with per-vessel data isolation.',
  },
  {
    type: 'Private Yacht',
    sub: 'Owner-operated',
    body: 'A lean crew still deserves a proper system. Cargo scales down without removing capability — you only use what you need.',
  },
];

/* ─── Page ───────────────────────────────────────────────────────────────── */
const WhoItsForPage = () => (
  <MarketingLayout>
    {/* Hero */}
    <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-24 px-6 text-center overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-[#00A8CC]/[0.06] blur-[100px] rounded-full pointer-events-none" />
      <div className="relative max-w-3xl mx-auto">
        <p className="text-[#00A8CC] text-xs font-semibold uppercase tracking-widest mb-5">Who it's for</p>
        <h1 className="font-heading text-4xl sm:text-5xl font-bold text-white leading-[1.08] tracking-tight mb-5">
          Built for everyone who runs the vessel
        </h1>
        <p className="text-lg text-white/50 leading-relaxed max-w-2xl mx-auto">
          Cargo gives each crew member exactly what they need — no more, no less.
          Role-based access means the captain sees everything, and crew see their world.
        </p>
      </div>
    </section>

    {/* Roles */}
    <section className="pb-24 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
          {roles.map(({ title, color, border, bg, dot, tag, headline, points }) => (
            <div key={title} className={`bg-[#141D2E] border ${border} rounded-2xl p-7`}>
              <div className="flex items-start justify-between mb-5">
                <div>
                  <h3 className={`font-heading font-semibold text-lg ${color}`}>{title}</h3>
                  <p className="text-white/35 text-sm mt-0.5">{headline}</p>
                </div>
                <span className={`flex-shrink-0 ml-3 text-[10px] font-bold px-2 py-0.5 rounded ${bg} ${color}`}>
                  {tag}
                </span>
              </div>
              <ul className="space-y-3">
                {points.map((p) => (
                  <li key={p} className="flex items-start gap-2.5 text-sm text-white/45">
                    <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* Vessel types */}
    <section className="py-24 px-6 bg-[#060E1A]">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-[#00A8CC] text-xs font-semibold uppercase tracking-widest mb-4">Vessel types</p>
          <h2 className="font-heading text-3xl sm:text-4xl font-bold text-white mb-4">
            Scales to the size of your operation
          </h2>
          <p className="text-white/45 text-lg max-w-2xl mx-auto">
            From private yachts to large charter fleets, Cargo adapts to the complexity you bring to it.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {vesselTypes.map(({ type, sub, body }) => (
            <div key={type} className="bg-[#141D2E] border border-white/[0.07] rounded-2xl p-6">
              <p className="font-heading font-semibold text-white text-base mb-0.5">{type}</p>
              <p className="text-[#00A8CC] text-xs font-medium mb-4">{sub}</p>
              <p className="text-sm text-white/40 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* CTA */}
    <section className="py-24 px-6">
      <div className="max-w-3xl mx-auto">
        <div className="relative bg-gradient-to-br from-[#0F1E30] to-[#0B1220] border border-[#00A8CC]/20 rounded-3xl p-12 text-center overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 bg-[#00A8CC]/10 blur-3xl rounded-full" />
          <div className="relative">
            <h2 className="font-heading text-3xl font-bold text-white mb-4">Sound like your vessel?</h2>
            <p className="text-white/45 text-lg mb-8">
              Book a demo and show us your setup — we'll walk through how Cargo fits your crew structure.
            </p>
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
  </MarketingLayout>
);

export default WhoItsForPage;

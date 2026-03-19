import React from 'react';
import { Link } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';

const values = [
  {
    title: 'Vessel-first thinking',
    body: 'Every feature decision starts with one question: does this match how vessels actually operate? If a workflow doesn\'t reflect reality on deck, it doesn\'t ship.',
  },
  {
    title: 'Respect for crew time',
    body: 'Crew are busy. The system should stay out of the way and surface what matters. Dense dashboards and feature bloat are the enemy.',
  },
  {
    title: 'Depth over breadth',
    body: 'We\'d rather do ten things exceptionally well than fifty things poorly. Every module in Cargo is built to handle the edge cases real operations throw at it.',
  },
  {
    title: 'Information stays on the vessel',
    body: 'Guest preferences, inventory data, and crew details are sensitive. We build with data ownership and privacy in mind at every layer.',
  },
];

const AboutPage = () => (
  <MarketingLayout>
    {/* Hero */}
    <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-24 px-6 text-center overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-[#00A8CC]/[0.06] blur-[100px] rounded-full pointer-events-none" />
      <div className="relative max-w-2xl mx-auto">
        <p className="text-[#00A8CC] text-xs font-semibold uppercase tracking-widest mb-5">About</p>
        <h1 className="font-heading text-4xl sm:text-5xl font-bold text-white leading-[1.08] tracking-tight mb-5">
          Built out of frustration with how yachts are run
        </h1>
        <p className="text-lg text-white/50 leading-relaxed">
          Cargo started from a simple observation: professional vessel operations are genuinely complex,
          but almost no software takes them seriously.
        </p>
      </div>
    </section>

    {/* Origin story */}
    <section className="pb-24 px-6">
      <div className="max-w-3xl mx-auto">
        <div className="bg-[#141D2E] border border-white/[0.07] rounded-2xl p-10 space-y-6">
          <p className="text-white/65 text-lg leading-relaxed">
            Most yacht operations tools are one of two things: consumer apps repurposed for professional
            use, or enterprise fleet-management software scaled down and stripped of context. Neither
            works for a 50m vessel with a crew of 12 running back-to-back charters.
          </p>
          <p className="text-white/65 text-lg leading-relaxed">
            The spreadsheets are relentless. There's one for inventory, one for crew scheduling, one
            for guest preferences, another for defects. They live on different laptops, go out of sync
            constantly, and disappear with rotating crew. Critical information becomes institutional
            knowledge instead of documented fact.
          </p>
          <p className="text-white/65 text-lg leading-relaxed">
            Cargo is our answer to that problem. A single system designed around the actual workflows
            of yacht operations — the way departments interact, the way information flows from charter
            to charter, the way crew accountability actually works.
          </p>
          <div className="pt-4 border-t border-white/[0.06]">
            <p className="text-white/35 text-sm italic">
              "We didn't want to build another tool that crew have to work around. We wanted to build
              the thing they'd actually reach for."
            </p>
            <p className="text-white/25 text-sm mt-2">— The Cargo team</p>
          </div>
        </div>
      </div>
    </section>

    {/* Mission */}
    <section className="py-24 px-6 bg-[#060E1A]">
      <div className="max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-[#00A8CC] text-xs font-semibold uppercase tracking-widest mb-4">Mission</p>
            <h2 className="font-heading text-3xl sm:text-4xl font-bold text-white leading-tight mb-6">
              Make professional vessel operations genuinely manageable
            </h2>
            <p className="text-white/50 text-lg leading-relaxed mb-6">
              We're building the system that vessel operations teams actually deserve — one where the
              software does the heavy lifting, crew have the context they need, and nothing falls
              through the cracks between departments.
            </p>
            <p className="text-white/50 text-lg leading-relaxed">
              Not a MVP. Not a pivot. A focused, deliberate platform for people who take their work seriously.
            </p>
          </div>
          {/* Values */}
          <div className="grid gap-4">
            {values.map(({ title, body }) => (
              <div key={title} className="bg-[#141D2E] border border-white/[0.07] rounded-xl p-5 flex gap-4">
                <div className="w-1.5 flex-shrink-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#00A8CC] mt-1.5" />
                </div>
                <div>
                  <h4 className="font-heading font-semibold text-white text-sm mb-1.5">{title}</h4>
                  <p className="text-xs text-white/40 leading-relaxed">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>

    {/* CTA */}
    <section className="py-24 px-6">
      <div className="max-w-3xl mx-auto text-center">
        <h2 className="font-heading text-3xl font-bold text-white mb-4">Want to be part of it?</h2>
        <p className="text-white/45 text-lg mb-8 max-w-lg mx-auto">
          We're building with a small group of early operators. If you want to shape how Cargo develops,
          now's the time.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/contact"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-[#00A8CC] hover:bg-[#0094B3] text-white font-semibold px-7 py-3.5 rounded-xl transition-colors duration-200 shadow-lg shadow-[#00A8CC]/20"
          >
            Book a Demo
          </Link>
          <Link
            to="/contact"
            className="w-full sm:w-auto inline-flex items-center justify-center border border-white/[0.12] hover:border-white/[0.22] text-white/60 hover:text-white font-medium px-7 py-3.5 rounded-xl transition-colors duration-200"
          >
            Join the Waitlist
          </Link>
        </div>
      </div>
    </section>
  </MarketingLayout>
);

export default AboutPage;

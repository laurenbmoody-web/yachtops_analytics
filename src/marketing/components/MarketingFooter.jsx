import React from 'react';
import { Link } from 'react-router-dom';

const footerLinks = [
  {
    heading: 'Product',
    links: [
      { label: 'Overview', href: '/product' },
      { label: 'Features', href: '/features' },
      { label: 'Who It\'s For', href: '/who-its-for' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'FAQ', href: '/faq' },
      { label: 'Contact', href: '/contact' },
    ],
  },
  {
    heading: 'Get Started',
    links: [
      { label: 'Book a Demo', href: '/contact' },
      { label: 'Join Waitlist', href: '/contact' },
      { label: 'Sign In', href: '/login-authentication' },
    ],
  },
];

const MarketingFooter = () => {
  return (
    <footer className="bg-[#050C16] border-t border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-12 lg:gap-8">

          {/* Brand column */}
          <div className="lg:col-span-2">
            <Link to="/" className="inline-flex items-center gap-2.5 mb-4">
              <div className="w-7 h-7 bg-[#00A8CC] rounded-[5px] flex items-center justify-center flex-shrink-0">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M2 3h10M2 7h7M2 11h5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              </div>
              <span className="font-heading font-semibold text-[17px] text-white tracking-tight">
                Cargo
              </span>
            </Link>
            <p className="text-sm text-white/40 leading-relaxed max-w-xs mt-3">
              The operational system for running yachts. One platform for inventory, crew, trips, guests, and everything in between.
            </p>
            <div className="flex items-center gap-3 mt-6">
              <Link
                to="/contact"
                className="inline-flex items-center bg-[#00A8CC] hover:bg-[#0094B3] text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors duration-200"
              >
                Book Demo
              </Link>
              <Link
                to="/contact"
                className="inline-flex items-center border border-white/[0.12] hover:border-white/[0.2] text-white/60 hover:text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors duration-200"
              >
                Join Waitlist
              </Link>
            </div>
          </div>

          {/* Link columns */}
          {footerLinks.map((col) => (
            <div key={col.heading}>
              <h4 className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-4">
                {col.heading}
              </h4>
              <ul className="space-y-3">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      to={link.href}
                      className="text-sm text-white/50 hover:text-white transition-colors duration-200"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-14 pt-6 border-t border-white/[0.06] flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-white/25">
            &copy; {new Date().getFullYear()} Cargo. All rights reserved.
          </p>
          <p className="text-xs text-white/25">
            Built for real yacht operations.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default MarketingFooter;

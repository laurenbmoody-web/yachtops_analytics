import React from 'react';
import { Link } from 'react-router-dom';

const COLUMNS = [
  {
    heading: 'Product',
    links: [
      { label: 'Overview', href: '/product' },
      { label: 'Features', href: '/features' },
      { label: "Who It's For", href: '/who-its-for' },
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
    heading: 'Access',
    links: [
      { label: 'Log in', href: '/login-authentication' },
      { label: 'Book a Demo', href: '/contact' },
      { label: 'Join Waitlist', href: '/contact' },
    ],
  },
];

const MarketingFooter = () => (
  <footer className="bg-[#F8FAFC]" style={{ borderTop: '2px solid #1E3A5F' }}>
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '56px 32px 36px' }}>

      {/* Top grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-12">

        {/* Brand */}
        <div className="md:col-span-1">
          <Link to="/" style={{ textDecoration: 'none', display: 'inline-block', marginBottom: 10 }}>
            <span
              className="mkt-archivo"
              style={{ fontWeight: 900, fontSize: 18, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1E3A5F' }}
            >
              Cargo
            </span>
          </Link>
          <p
            className="mkt-dmsans"
            style={{ fontWeight: 400, fontSize: 13, color: '#64748B', lineHeight: 1.65, maxWidth: 220, marginTop: 8 }}
          >
            The operational system for running yachts. One platform for everything.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 16 }}>
            <a href="#" aria-label="Instagram" style={{ color: '#64748B', lineHeight: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" stroke="none" />
              </svg>
            </a>
            <a href="#" aria-label="LinkedIn" style={{ color: '#64748B', lineHeight: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
                <rect x="2" y="9" width="4" height="12" />
                <circle cx="4" cy="4" r="2" />
              </svg>
            </a>
            <a href="#" aria-label="X" style={{ color: '#64748B', lineHeight: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.258 5.63 5.906-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
          </div>
          <div className="flex gap-2 mt-5">
            <Link
              to="/contact"
              className="mkt-archivo"
              style={{
                fontWeight: 900, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
                color: 'white', backgroundColor: '#1E3A5F', borderRadius: 50, padding: '7px 16px', textDecoration: 'none',
              }}
            >
              Book Demo
            </Link>
            <Link
              to="/contact"
              className="mkt-archivo"
              style={{
                fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
                color: '#1E3A5F', border: '2px solid #1E3A5F', borderRadius: 50, padding: '5px 16px', textDecoration: 'none',
              }}
            >
              Waitlist
            </Link>
          </div>
        </div>

        {/* Link columns */}
        {COLUMNS.map(({ heading, links }) => (
          <div key={heading}>
            <h4
              className="mkt-archivo"
              style={{ fontWeight: 900, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#1E3A5F', marginBottom: 16 }}
            >
              {heading}
            </h4>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {links.map(({ label, href }) => (
                <li key={label}>
                  <Link
                    to={href}
                    className="mkt-dmsans transition-colors duration-150"
                    style={{ fontWeight: 400, fontSize: 13, color: '#64748B', textDecoration: 'none' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#1E3A5F')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#64748B')}
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Bottom bar */}
      <div
        className="flex flex-col sm:flex-row justify-between items-center gap-3"
        style={{ marginTop: 48, paddingTop: 20, borderTop: '1px solid #E2E8F0' }}
      >
        <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 12, color: '#64748B' }}>
          &copy; {new Date().getFullYear()} Cargo. All rights reserved.
        </p>
        <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 12, color: '#64748B' }}>
          Built for real yacht operations.
        </p>
      </div>
    </div>
  </footer>
);

export default MarketingFooter;

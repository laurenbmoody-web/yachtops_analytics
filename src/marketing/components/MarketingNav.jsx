import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const NAV_LINKS = [
  { label: 'Product', href: '/product' },
  { label: 'Features', href: '/features' },
  { label: 'About', href: '/about' },
  { label: 'FAQ', href: '/faq' },
];

const MarketingNav = () => {
  const location = useLocation();

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 bg-[#F8FAFC]"
      style={{ borderBottom: '2px solid #1E3A5F' }}
    >
      <div
        className="flex items-center justify-between"
        style={{ maxWidth: 1280, margin: '0 auto', padding: '0 32px', height: 56 }}
      >
        {/* Logo */}
        <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/cargo-logo.svg" alt="Cargo" style={{ height: 28, width: 'auto' }} />
          <span
            className="mkt-archivo"
            style={{
              fontWeight: 900,
              fontSize: 18,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#1E3A5F',
            }}
          >
            Cargo
          </span>
        </Link>

        {/* Centre links */}
        <nav className="hidden md:flex items-center">
          {NAV_LINKS.map((link, i) => {
            const active = location.pathname === link.href;
            return (
              <React.Fragment key={link.href}>
                <Link
                  to={link.href}
                  className="mkt-archivo transition-colors duration-150"
                  style={{
                    fontWeight: 700,
                    fontSize: 11,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: active ? '#1E3A5F' : '#64748B',
                    textDecoration: 'none',
                    padding: '0 16px',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#1E3A5F')}
                  onMouseLeave={e => (e.currentTarget.style.color = active ? '#1E3A5F' : '#64748B')}
                >
                  {link.label}
                </Link>
                {i < NAV_LINKS.length - 1 && (
                  <span
                    style={{ width: 1, height: 14, backgroundColor: '#E2E8F0', flexShrink: 0 }}
                  />
                )}
              </React.Fragment>
            );
          })}
        </nav>

        {/* Right */}
        <div className="flex items-center" style={{ gap: 4 }}>
          <Link
            to="/login-authentication"
            className="mkt-archivo transition-colors duration-150"
            style={{
              fontWeight: 900,
              fontSize: 11,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: '#64748B',
              textDecoration: 'none',
              padding: '0 14px',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#1E3A5F')}
            onMouseLeave={e => (e.currentTarget.style.color = '#64748B')}
          >
            Log in
          </Link>
          <Link
            to="/contact"
            className="mkt-archivo transition-colors duration-150"
            style={{
              fontWeight: 900,
              fontSize: 11,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'white',
              backgroundColor: '#1E3A5F',
              borderRadius: 50,
              padding: '8px 18px',
              textDecoration: 'none',
              display: 'inline-block',
            }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#141D2E')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#1E3A5F')}
          >
            Book Demo
          </Link>
        </div>
      </div>
    </header>
  );
};

export default MarketingNav;

// The shore office's page frame — the crew dashboard's frame, not a sidebar.
//
// Same three parts, in the same order, as pages/dashboard/index.jsx:
//   .nav-header fixed top bar (+ its 64px spacer)
//   a max-w-[1600px] centred container on the #F8FAFC ground
//   a .cargo-editorial 12-column grid of .ce-card widgets
//
// The crew <Header /> itself can't be reused: it's vessel-scoped — search,
// alerts, basket, a nav built from a tenant_members role — and a management user
// has none of those. So this is the same bar with the office's own contents,
// using the same global .nav-header class rather than a private copy of it.
import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import Image from '../../../components/AppImage';
import { supabase } from '../../../lib/supabaseClient';
import useManagementCompany from '../../../hooks/useManagementCompany';
import { canRunTeam, tierLabel } from '../../../services/managementView';
import { useAuth } from '../../../contexts/AuthContext';
import '../../../styles/editorial-tokens.css';
import '../../dashboard/dashboard-widgets.css';
import './management-layout.css';

const initialsOf = (s) => {
  const parts = String(s || '').replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean);
  const two = parts.length > 1 ? parts[0][0] + parts[1][0] : String(s || '?').slice(0, 2);
  return two.toUpperCase();
};

export default function ManagementLayout({ eyebrow, title, lede, actions, children }) {
  const navigate = useNavigate();
  const { company } = useManagementCompany();
  const { user } = useAuth();

  const signOut = async () => {
    try { await supabase.auth.signOut(); } catch (err) { console.error('[MGMT] sign out', err); }
    window.location.href = '/login-authentication';
  };

  const who = user?.user_metadata?.full_name || user?.email || '';
  const nav = [
    { to: '/management', end: true, label: 'Fleet' },
    { to: '/management/team', label: canRunTeam(company?.permission_tier) ? 'Team' : 'Colleagues' },
    { to: '/management/settings', label: 'Company' },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F8FAFC' }}>
      <header className="nav-header">
        <div className="flex items-center gap-3 flex-shrink-0 cursor-pointer" onClick={() => navigate('/management')}>
          <Image src="/centered-logo.svg" alt="Cargo" className="h-8 w-auto object-contain" />
          <div className="text-muted-foreground text-xl">|</div>
          {/* The firm, where the vessel name sits for crew — a management user
              may also hold a crew login, so whose workspace this is matters. */}
          <span className="mgl-co">{company?.company_name || 'Management'}</span>
        </div>

        <nav className="flex items-center gap-1 flex-1 justify-center">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `mgl-tab${isActive ? ' on' : ''}`}>
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="mgl-who">
            <b>{who}</b>
            <em>{tierLabel(company?.permission_tier)}</em>
          </span>
          <span className="mgl-avatar">{initialsOf(who)}</span>
          <div className="w-px h-6 bg-border mx-1" />
          <button type="button" className="mgl-out" onClick={signOut} title="Sign out" aria-label="Sign out">
            <Icon name="LogOut" size={17} />
          </button>
        </div>
      </header>
      <div className="h-16" aria-hidden="true" />

      <div className="max-w-[1600px] mx-auto p-6">
        <div className="flex items-end justify-between gap-6 mb-6">
          <div className="min-w-0">
            {eyebrow && <p className="ce-eyebrow"><span className="dot">●</span> {eyebrow}</p>}
            <h1 className="mgl-h1">{title}</h1>
            {lede && <p className="mgl-lede">{lede}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
        </div>

        <div className="cargo-editorial">{children}</div>
      </div>
    </div>
  );
}

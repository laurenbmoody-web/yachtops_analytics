// The shore office's portal chrome.
//
// Modelled on SupplierLayout, not on the crew Header — because management are
// the same kind of user a supplier is: an outside party with their own
// workspace, their own team and a handful of sections, who is not crew on any
// vessel. That layout is already the answer for that shape, so this mirrors it
// (sidebar with grouped nav, sticky topbar, workspace identity at the top, the
// person at the bottom) rather than inventing a third pattern.
//
// Surfaces use the --d-* tokens from styles/editorial-tokens.css via the
// .cargo-editorial scope, which is the same system the overview dashboard's
// widgets are built on — so a card here and a card there are the same card.
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

const NAV_GROUPS = [
  {
    label: 'Work',
    items: [{ to: '/management', end: true, icon: 'LayoutDashboard', label: 'Fleet' }],
  },
  {
    label: 'Your company',
    items: [
      { to: '/management/team', icon: 'Users', label: 'Team' },
      { to: '/management/settings', icon: 'Building2', label: 'Company' },
    ],
  },
];

const initialsOf = (s) => {
  const parts = String(s || '').replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean);
  const two = parts.length > 1 ? parts[0][0] + parts[1][0] : String(s || '?').slice(0, 2);
  return two.toUpperCase();
};

export default function ManagementLayout({ title, eyebrow, actions, children }) {
  const navigate = useNavigate();
  const { company } = useManagementCompany();
  const { user } = useAuth();

  const signOut = async () => {
    try { await supabase.auth.signOut(); } catch (err) { console.error('[MGMT] sign out', err); }
    window.location.href = '/login-authentication';
  };

  const name = user?.user_metadata?.full_name || user?.email || '';

  return (
    <div className="cargo-editorial mgl">
      <aside className="mgl-side">
        <div className="mgl-logo" onClick={() => navigate('/management')} role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate('/management'); }}>
          <Image src="/centered-logo.svg" alt="Cargo" />
        </div>

        {/* Whose workspace this is. A management user may hold a Cargo login for
            a boat too, so naming the firm up front removes the doubt. */}
        <div className="mgl-who">
          <span className="mgl-who-mark">{initialsOf(company?.company_name)}</span>
          <span className="mgl-who-t">
            <b>{company?.company_name || 'Management'}</b>
            <em>{company?.vessels != null
              ? `${company.vessels} ${company.vessels === 1 ? 'vessel' : 'vessels'}`
              : 'Shore office'}</em>
          </span>
        </div>

        <nav className="mgl-nav">
          {NAV_GROUPS.map((g) => (
            <div key={g.label} className="mgl-nav-group">
              <div className="mgl-nav-label">{g.label}</div>
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.end}
                  className={({ isActive }) => `mgl-nav-item${isActive ? ' active' : ''}`}>
                  <Icon name={it.icon} size={16} />
                  <span>{it.label === 'Team' && !canRunTeam(company?.permission_tier) ? 'Colleagues' : it.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="mgl-foot">
          <span className="mgl-avatar">{initialsOf(name)}</span>
          <span className="mgl-foot-t">
            <b>{name}</b>
            <em>{tierLabel(company?.permission_tier)}</em>
          </span>
          <button type="button" onClick={signOut} aria-label="Sign out" title="Sign out">
            <Icon name="LogOut" size={15} />
          </button>
        </div>
      </aside>

      <div className="mgl-main">
        <header className="mgl-top">
          <div className="mgl-top-t">
            {eyebrow && <p className="ce-eyebrow"><span className="dot">●</span> {eyebrow}</p>}
            <h1 className="mgl-top-h">{title}</h1>
          </div>
          {actions && <div className="mgl-top-a">{actions}</div>}
        </header>

        <main className="mgl-body">{children}</main>
      </div>
    </div>
  );
}

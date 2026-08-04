// The frame around the shore office's side of Cargo.
//
// Not the crew <Header />: that one is vessel-scoped — search, alerts, the
// basket, a nav built out of a tenant_members role — and a management user has
// none of those. Giving them the crew chrome would be offering doors that are
// all locked. This is the small amount they actually need: whose firm they're
// in, the fleet, their team, and the way out.
import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import Image from '../../../components/AppImage';
import { supabase } from '../../../lib/supabaseClient';
import useManagementCompany from '../../../hooks/useManagementCompany';
import { canRunTeam } from '../../../services/managementView';
import './management-shell.css';

export default function ManagementShell({ children }) {
  const navigate = useNavigate();
  const { company } = useManagementCompany();

  const signOut = async () => {
    try { await supabase.auth.signOut(); } catch (err) { console.error('[MGMT] sign out', err); }
    window.location.href = '/login-authentication';
  };

  return (
    <div className="mg">
      <header className="mg-bar">
        <div className="mg-brand" onClick={() => navigate('/management')}>
          <Image src="/centered-logo.svg" alt="Cargo" className="mg-logo" />
          <span className="mg-div">|</span>
          <span className="mg-co">{company?.company_name || 'Management'}</span>
        </div>

        <nav className="mg-nav">
          <NavLink to="/management" end className={({ isActive }) => `mg-link${isActive ? ' on' : ''}`}>
            Fleet
          </NavLink>
          {/* Everyone sees their colleagues; only an owner or admin can change
              the list, which the page itself enforces. */}
          <NavLink to="/management/team" className={({ isActive }) => `mg-link${isActive ? ' on' : ''}`}>
            {canRunTeam(company?.permission_tier) ? 'Team' : 'Colleagues'}
          </NavLink>
          <NavLink to="/management/settings" className={({ isActive }) => `mg-link${isActive ? ' on' : ''}`}>
            Company
          </NavLink>
        </nav>

        {/* The label is wrapped so it can drop away on a narrow bar, leaving the
            icon — the rule that hides it needs something to hide. */}
        <button type="button" className="mg-out" onClick={signOut}>
          <Icon name="LogOut" size={15} /><span>Sign out</span>
        </button>
      </header>

      <main className="mg-body">{children}</main>
    </div>
  );
}

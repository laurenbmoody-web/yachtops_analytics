// The shore office's page frame — the crew dashboard's frame, part for part.
//
//   .nav-header fixed bar: logo | workspace name · search · bell, gear, avatar
//   a max-w-[1600px] centred container on the #F8FAFC ground
//   a .cargo-editorial 12-column grid of .ce-card widgets
//
// The crew <Header /> component itself can't be reused: it reads a tenant on
// every line — vessel search, the inbox drawer, the basket, a nav built out of a
// tenant_members role — and a management user has no tenant at all. So this is
// the same bar, the same classes, the same zones, with the office's own
// contents: their firm where the vessel name sits, their vessels in the search,
// their sections in the avatar menu.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import Icon from '../../../components/AppIcon';
import Image from '../../../components/AppImage';
import { supabase } from '../../../lib/supabaseClient';
import useManagementCompany from '../../../hooks/useManagementCompany';
import { listManagedVessels } from '../../../services/managementService';
import { canRunTeam, tierLabel, sortFleet } from '../../../services/managementView';
import { useAuth } from '../../../contexts/AuthContext';
import { getInitials } from '../../../utils/profileHelpers';
import '../../../styles/editorial-tokens.css';
import '../../dashboard/dashboard-widgets.css';
import '../../../components/navigation/header-search.css';
import './management-layout.css';

export default function ManagementLayout({ eyebrow, title, lede, actions, children }) {
  const navigate = useNavigate();
  const { company } = useManagementCompany();
  const { user } = useAuth();

  const [fleet, setFleet] = useState([]);
  const [q, setQ] = useState('');
  const [openSearch, setOpenSearch] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const searchRef = useRef(null);
  const menuRef = useRef(null);
  const popRef = useRef(null);

  // The office's own vessels are the only thing worth searching here — a dozen
  // yachts is exactly the number where scanning a grid stops being quicker.
  useEffect(() => {
    let live = true;
    listManagedVessels().then(({ data }) => { if (live) setFleet(sortFleet(data)); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const onDoc = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setOpenSearch(false);
      if (menuRef.current && !menuRef.current.contains(e.target)
        && popRef.current && !popRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return fleet.filter((v) => String(v.vessel_name || '').toLowerCase().includes(t)).slice(0, 6);
  }, [q, fleet]);

  const go = (tenantId) => {
    setQ(''); setOpenSearch(false);
    navigate(`/management/vessel/${tenantId}`);
  };

  const signOut = async () => {
    try { await supabase.auth.signOut(); } catch (err) { console.error('[MGMT] sign out', err); }
    window.location.href = '/login-authentication';
  };

  const who = user?.user_metadata?.full_name || user?.email || '';
  const menu = [
    { label: 'Fleet', icon: 'LayoutDashboard', to: '/management' },
    { label: canRunTeam(company?.permission_tier) ? 'Team' : 'Colleagues', icon: 'Users', to: '/management/team' },
    { label: 'Company', icon: 'Building2', to: '/management/settings' },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F8FAFC' }}>
      <header className="nav-header">
        {/* LEFT: logo + whose workspace this is */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <Image src="/centered-logo.svg" alt="Cargo"
            className="h-8 w-auto object-contain cursor-pointer hover:opacity-80 transition-smooth"
            onClick={() => navigate('/management')} />
          <div className="text-muted-foreground text-xl">|</div>
          <span className="mgl-co">{company?.company_name || 'Management'}</span>
        </div>

        {/* CENTRE: search — the office's vessels */}
        <div className="flex-1 flex justify-center px-8">
          <div className="relative w-full max-w-md" ref={searchRef}>
            <Icon name="Search" size={18} className="hsearch-ic" />
            <input type="text" className="hsearch-input" value={q}
              placeholder="Search your vessels…"
              onChange={(e) => { setQ(e.target.value); setOpenSearch(true); }}
              onFocus={() => { if (q.trim()) setOpenSearch(true); }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setQ(''); setOpenSearch(false); }
                if (e.key === 'Enter' && hits[0]) go(hits[0].tenant_id);
              }} />
            {q && (
              <button className="hsearch-clear" aria-label="Clear search"
                onClick={() => { setQ(''); setOpenSearch(false); }}>
                <Icon name="X" size={14} />
              </button>
            )}

            {openSearch && q.trim() && (
              <div className="hsearch-pop">
                {hits.length === 0 ? (
                  <div className="hsearch-msg">No vessel matches “{q}”</div>
                ) : (
                  <div>
                    <div className="hsearch-group-h">Vessels</div>
                    {hits.map((v) => (
                      <div key={v.tenant_id} className="hsearch-itemrow"
                        onMouseDown={() => go(v.tenant_id)} role="button" tabIndex={0}>
                        <Icon name="Anchor" size={15} className="hsearch-ico" />
                        <div className="hsearch-body">
                          <div>{v.vessel_name}</div>
                          <small>{(v.awaiting_signoff || 0) > 0
                            ? `${v.awaiting_signoff} to sign off` : 'Nothing waiting'}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: alerts, settings, avatar — the crew bar's zone, same shape */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <button className="relative p-2 hover:bg-muted rounded-lg transition-smooth"
            title="Months waiting on you" aria-label="Months waiting on you"
            onClick={() => navigate('/management')}>
            <Icon name="Bell" size={20} color="var(--color-foreground)" />
            {fleet.reduce((n, v) => n + (v.awaiting_signoff || 0), 0) > 0 && (
              <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] text-white text-xs font-semibold rounded-full flex items-center justify-center px-1"
                style={{ background: '#C65A1A' }}>
                {fleet.reduce((n, v) => n + (v.awaiting_signoff || 0), 0)}
              </span>
            )}
          </button>

          <button className="p-2 hover:bg-muted rounded-lg transition-smooth"
            title="Company settings" aria-label="Company settings"
            onClick={() => navigate('/management/settings')}>
            <Icon name="Settings" size={20} color="var(--color-foreground)" />
          </button>

          <div className="w-px h-6 bg-border mx-1" />

          <div className="relative" ref={menuRef}>
            <button onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 p-2 hover:bg-muted rounded-lg transition-smooth">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold text-sm overflow-hidden">
                {getInitials(who) || 'U'}
              </div>
              <Icon name="ChevronDown" size={16} color="var(--color-foreground)" />
            </button>

            {menuOpen && createPortal(
              <div ref={popRef} className="mgl-menu">
                <div className="mgl-menu-head">
                  <div className="mgl-menu-av">{getInitials(who) || 'U'}</div>
                  <div className="min-w-0">
                    <div className="mgl-menu-name">{who}</div>
                    <div className="mgl-menu-sub">
                      {tierLabel(company?.permission_tier)} · {company?.company_name || 'Management'}
                    </div>
                  </div>
                </div>
                <div className="mgl-menu-items">
                  {menu.map((m) => (
                    <button key={m.to} type="button" className="mgl-menu-item"
                      onClick={() => { setMenuOpen(false); navigate(m.to); }}>
                      <Icon name={m.icon} size={16} /> {m.label}
                    </button>
                  ))}
                  <div className="mgl-menu-rule" />
                  <button type="button" className="mgl-menu-item" onClick={signOut}>
                    <Icon name="LogOut" size={16} /> Sign out
                  </button>
                </div>
              </div>, document.body)}
          </div>
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

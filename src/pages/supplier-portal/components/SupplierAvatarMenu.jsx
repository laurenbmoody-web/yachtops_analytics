import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown, ChevronRight, User, Building2, Users, MapPin,
  CreditCard, Receipt, Plug, Bell, DollarSign, ScrollText,
  HelpCircle, LogOut,
} from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';
import { useSupplier } from '../../../contexts/SupplierContext';
import { getSupplierTier } from '../../../components/SupplierRoleGuard';

const ROLE_LABELS = {
  owner: 'ADMIN',
  sales: 'MANAGER',
  accounts: 'MANAGER',
  logistics: 'STAFF',
};

const ROLE_BADGE = {
  ADMIN:   { bg: 'rgba(99,102,241,0.12)',   color: '#4f46e5' },
  MANAGER: { bg: 'rgba(14,165,233,0.12)',   color: '#0369a1' },
  STAFF:   { bg: 'rgba(100,116,139,0.12)',  color: '#475569' },
};

const SectionLabel = ({ label }) => (
  <div style={{
    padding: '6px 16px 3px',
    fontFamily: 'Outfit', fontWeight: 700,
    fontSize: 10, letterSpacing: '0.14em',
    textTransform: 'uppercase', color: 'var(--muted)',
  }}>{label}</div>
);

const Divider = () => (
  <div style={{ borderTop: '1px solid var(--line)', margin: '4px 0' }} />
);

const MenuItem = ({ icon: Icon, label, onClick, danger, href }) => {
  const inner = (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '9px 16px',
        background: 'transparent', border: 'none', textAlign: 'left',
        cursor: 'pointer', fontSize: 13,
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        color: danger ? 'var(--red)' : 'var(--fg)',
        transition: 'background 100ms',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {Icon && <Icon size={15} style={{ color: danger ? 'var(--red)' : 'var(--muted-strong)', flexShrink: 0 }} />}
      <span>{label}</span>
    </button>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', display: 'block' }}>
        {inner}
      </a>
    );
  }
  return inner;
};

const SupplierAvatarMenu = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { supplier, contact } = useSupplier();
  const [open, setOpen] = useState(false);
  const [workspaceHover, setWorkspaceHover] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setWorkspaceHover(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const displayName = contact?.name ?? user?.email?.split('@')[0] ?? 'Supplier';
  const email = user?.email ?? '';
  const initials = displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  const contactRole = contact?.role ?? 'logistics';
  const tier = getSupplierTier(contactRole);
  const roleLabel = ROLE_LABELS[contactRole] ?? 'STAFF';
  const badgeStyle = ROLE_BADGE[roleLabel];

  const isAdmin = tier === 'admin';
  const isManager = tier === 'manager' || tier === 'admin';

  const go = (path) => { setOpen(false); navigate(path); };

  const handleLogout = async () => {
    setOpen(false);
    await supabase.auth.signOut();
    navigate('/supplier/login', { replace: true });
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Avatar-chevron pill */}
      <button
        onClick={() => { setOpen(o => !o); setWorkspaceHover(false); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '4px 10px 4px 4px',
          borderRadius: 999,
          border: '1px solid var(--line)',
          background: open ? 'var(--chip-bg)' : 'transparent',
          cursor: 'pointer', transition: 'background 120ms',
        }}
        aria-label="Account menu"
        aria-expanded={open}
      >
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: '#1C2340', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'Outfit', fontWeight: 700, fontSize: 11, flexShrink: 0,
        }}>{initials}</div>
        <ChevronDown size={14} style={{ color: 'var(--muted-strong)' }} />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => { setOpen(false); setWorkspaceHover(false); }}
            style={{ position: 'fixed', inset: 0, zIndex: 98 }}
          />

          {/* Dropdown */}
          <div style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            width: 320, background: 'var(--card)',
            border: '1px solid var(--line)', borderRadius: 14,
            boxShadow: '0 12px 36px rgba(15,22,41,0.13)',
            zIndex: 99, overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              padding: '16px',
              background: 'var(--bg-3)',
              borderBottom: '1px solid var(--line)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: '#1C2340', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'Outfit', fontWeight: 700, fontSize: 15, flexShrink: 0,
                }}>{initials}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'Outfit', fontWeight: 700, fontSize: 14,
                    color: 'var(--fg)', lineHeight: 1.2,
                  }}>{displayName}</div>
                  <div style={{
                    fontSize: 12, color: 'var(--muted-strong)', marginTop: 2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{email}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  fontFamily: 'Outfit', fontWeight: 700, fontSize: 10.5,
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: 'var(--muted-strong)',
                }}>{supplier?.name ?? '—'}</span>
                <span style={{
                  fontFamily: 'Outfit', fontWeight: 700,
                  fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
                  padding: '2px 7px', borderRadius: 999,
                  background: badgeStyle.bg, color: badgeStyle.color,
                }}>{roleLabel}</span>
              </div>
            </div>

            <div style={{ paddingBottom: 4 }}>
              {/* Personal */}
              <div style={{ paddingTop: 4 }}>
                <SectionLabel label="Personal" />
                <MenuItem icon={User} label="My profile" onClick={() => go('/supplier/profile')} />
              </div>

              {/* Workspace — admin + manager */}
              {isManager && (
                <>
                  <Divider />
                  <SectionLabel label="Workspace" />
                  <MenuItem icon={Building2} label="Company profile"    onClick={() => go('/supplier/settings/company')} />
                  <MenuItem icon={Users}     label="Team & permissions" onClick={() => go('/supplier/settings/team')} />
                  <MenuItem icon={MapPin}    label="Delivery zones"     onClick={() => go('/supplier/settings/zones')} />
                  {isAdmin && (
                    <MenuItem icon={CreditCard} label="Payment & banking" onClick={() => go('/supplier/settings/payment')} />
                  )}
                  <MenuItem icon={Receipt} label="Tax & invoicing"       onClick={() => go('/supplier/settings/tax')} />
                  {isAdmin && (
                    <MenuItem icon={Plug} label="Integrations"            onClick={() => go('/supplier/settings/integrations')} />
                  )}
                  <MenuItem icon={Bell} label="Notifications"             onClick={() => go('/supplier/settings/notifications')} />
                </>
              )}

              {/* Operations — admin + manager */}
              {isManager && (
                <>
                  <Divider />
                  <SectionLabel label="Operations" />
                  {isAdmin && (
                    <MenuItem icon={DollarSign} label="Billing & subscription" onClick={() => go('/supplier/billing')} />
                  )}
                  <MenuItem icon={ScrollText} label="Audit log"   onClick={() => go('/supplier/audit')} />
                  <MenuItem icon={HelpCircle} label="Help & support" href="mailto:support@cargo.works" />
                </>
              )}

              {/* Switch workspace */}
              <Divider />
              <div
                style={{ position: 'relative' }}
                onMouseEnter={() => setWorkspaceHover(true)}
                onMouseLeave={() => setWorkspaceHover(false)}
              >
                <button
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '9px 16px',
                    background: workspaceHover ? 'var(--bg-2)' : 'transparent',
                    border: 'none', textAlign: 'left', cursor: 'pointer',
                    fontSize: 13, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                    color: 'var(--fg)', transition: 'background 100ms',
                  }}
                >
                  <Building2 size={15} style={{ color: 'var(--muted-strong)', flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>Switch workspace</span>
                  <ChevronRight size={14} style={{ color: 'var(--muted-strong)' }} />
                </button>
                {workspaceHover && (
                  <div style={{
                    position: 'absolute', right: 'calc(100% + 4px)', top: 0,
                    width: 220, background: 'var(--card)',
                    border: '1px solid var(--line)', borderRadius: 10,
                    boxShadow: '0 8px 24px rgba(15,22,41,0.10)',
                    padding: 6, zIndex: 100,
                  }}>
                    <button
                      onClick={() => go('/supplier/overview')}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 9,
                        width: '100%', padding: '8px 10px', borderRadius: 8,
                        background: 'var(--chip-bg)', border: '1px solid var(--line)',
                        cursor: 'pointer', textAlign: 'left',
                        fontFamily: 'Outfit', fontSize: 12, fontWeight: 600, color: 'var(--fg)',
                      }}
                    >
                      <div style={{
                        width: 22, height: 22, borderRadius: 6,
                        background: '#1C2340', color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 9, fontWeight: 800, flexShrink: 0, fontFamily: 'Outfit',
                      }}>
                        {(supplier?.name ?? 'SU').slice(0, 2).toUpperCase()}
                      </div>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {supplier?.name ?? 'Workspace'}
                      </span>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
                    </button>
                  </div>
                )}
              </div>

              {/* Logout */}
              <Divider />
              <MenuItem icon={LogOut} label="Log out" onClick={handleLogout} danger />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default SupplierAvatarMenu;

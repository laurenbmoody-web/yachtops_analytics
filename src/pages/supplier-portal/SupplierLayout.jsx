import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingBag, Truck, FileText, BookOpen,
  Users, MessageSquare, RotateCcw, Settings, LogOut, Bell, Search,
  ChevronDown,
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useSupplier } from '../../contexts/SupplierContext';
import './supplier-portal.css';

const NAV = [
  { to: '/supplier/overview',   icon: LayoutDashboard, label: 'Overview' },
  { to: '/supplier/orders',     icon: ShoppingBag,     label: 'Orders' },
  { to: '/supplier/deliveries', icon: Truck,           label: 'Deliveries' },
  { to: '/supplier/invoices',   icon: FileText,        label: 'Invoices' },
  { to: '/supplier/products',   icon: BookOpen,        label: 'Products' },
  { to: '/supplier/clients',    icon: Users,           label: 'Clients' },
  { to: '/supplier/messages',   icon: MessageSquare,   label: 'Messages' },
  { to: '/supplier/returns',    icon: RotateCcw,       label: 'Returns' },
];

const SupplierLayout = () => {
  const navigate = useNavigate();
  const { supplier, contact } = useSupplier();
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/supplier/login', { replace: true });
  };

  const displayName = contact?.name ?? supplier?.name ?? 'Supplier';
  const initials = displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div id="sp-root">
      <div className="sp-shell">
        {/* Sidebar */}
        <aside className="sp-sidebar">
          <div className="sp-sidebar-logo">
            <img src="/assets/images/cargo_merged_originalmark_syne800_true.png" alt="Cargo" style={{ height: 26 }} />
            <span style={{ fontFamily: 'Outfit', fontWeight: 800, fontSize: 13, color: 'var(--navy)', letterSpacing: '-0.02em' }}>Suppliers</span>
          </div>

          {supplier && (
            <div className="sp-sidebar-who">
              <div style={{
                width: 32, height: 32, borderRadius: 9,
                background: 'var(--navy)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'Outfit', fontWeight: 800, fontSize: 12, flexShrink: 0,
              }}>
                {(supplier.name ?? '?').slice(0, 2).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{supplier.name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted-s)' }}>Supplier portal</div>
              </div>
            </div>
          )}

          <nav className="sp-sidebar-nav">
            <div className="sp-nav-group-label">Workspace</div>
            {NAV.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => `sp-nav-item${isActive ? ' active' : ''}`}
              >
                <Icon size={15} />
                {label}
              </NavLink>
            ))}
          </nav>

          <div style={{ marginTop: 'auto', padding: '0 8px 12px' }}>
            <NavLink
              to="/supplier/settings"
              className={({ isActive }) => `sp-nav-item${isActive ? ' active' : ''}`}
            >
              <Settings size={15} />
              Settings
            </NavLink>
          </div>
        </aside>

        {/* Main area */}
        <div className="sp-main">
          {/* Topbar */}
          <header className="sp-topbar">
            <div className="sp-topbar-search">
              <Search size={13} style={{ color: 'var(--muted-s)' }} />
              <input placeholder="Search orders, products…" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
              <span style={{
                background: '#FEF3C7', color: '#92400E',
                fontFamily: 'Outfit', fontWeight: 700, fontSize: 10.5,
                padding: '3px 8px', borderRadius: 5, letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}>Sandbox</span>
              <button className="sp-icon-btn" style={{ position: 'relative' }}>
                <Bell size={14} />
              </button>

              {/* User menu */}
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setUserMenuOpen(o => !o)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    padding: '5px 10px', borderRadius: 8,
                    border: '1px solid var(--line)', background: 'var(--card)',
                    cursor: 'pointer', fontSize: 13,
                  }}
                >
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%',
                    background: 'var(--navy)', color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 800, fontSize: 10, flexShrink: 0,
                  }}>{initials}</div>
                  <span style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--fg)' }}>{displayName}</span>
                  <ChevronDown size={12} style={{ color: 'var(--muted-s)' }} />
                </button>

                {userMenuOpen && (
                  <>
                    <div
                      onClick={() => setUserMenuOpen(false)}
                      style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                    />
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                      background: 'var(--card)', border: '1px solid var(--line)',
                      borderRadius: 10, padding: '6px', minWidth: 180,
                      boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100,
                    }}>
                      <NavLink
                        to="/supplier/settings"
                        onClick={() => setUserMenuOpen(false)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 7, fontSize: 13, color: 'var(--fg)', textDecoration: 'none' }}
                      >
                        <Settings size={13} /> Settings
                      </NavLink>
                      <div style={{ borderTop: '1px solid var(--line)', margin: '4px 0' }} />
                      <button
                        onClick={() => { setUserMenuOpen(false); handleLogout(); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          width: '100%', padding: '8px 10px', borderRadius: 7,
                          fontSize: 13, color: 'var(--red)', background: 'transparent',
                          border: 'none', cursor: 'pointer', textAlign: 'left',
                        }}
                      >
                        <LogOut size={13} /> Log out
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </header>

          {/* Page content */}
          <div className="sp-content">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SupplierLayout;

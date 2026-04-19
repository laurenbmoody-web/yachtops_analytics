import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingBag, Truck, FileText, BookOpen, Tag,
  Users, MessageSquare, RotateCcw, Settings, LogOut,
  Bell, Search, HelpCircle, ChevronRight,
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useSupplier } from '../../contexts/SupplierContext';
import { WORKSPACE_CONFIG } from './config';
import './supplier-portal.css';

const NAV_GROUPS = [
  {
    label: 'Work',
    items: [
      { to: '/supplier/overview',   icon: LayoutDashboard, label: 'Overview' },
      { to: '/supplier/orders',     icon: ShoppingBag,     label: 'Orders' },
      { to: '/supplier/deliveries', icon: Truck,           label: 'Deliveries' },
      { to: '/supplier/invoices',   icon: FileText,        label: 'Invoices' },
    ],
  },
  {
    label: 'Catalogue',
    items: [
      { to: '/supplier/products',    icon: BookOpen, label: 'Products' },
      { to: '/supplier/price-lists', icon: Tag,      label: 'Price lists' },
    ],
  },
  {
    label: 'Relationships',
    items: [
      { to: '/supplier/clients',  icon: Users,         label: 'Yacht clients' },
      { to: '/supplier/messages', icon: MessageSquare, label: 'Messages' },
      { to: '/supplier/returns',  icon: RotateCcw,     label: 'Returns' },
      { to: '/supplier/settings', icon: Settings,      label: 'Settings' },
    ],
  },
];

const SupplierLayout = () => {
  const navigate = useNavigate();
  const { supplier, contact } = useSupplier();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/supplier/login', { replace: true });
  };

  const displayName = contact?.name ?? supplier?.name ?? 'Supplier';
  const initials = displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const tenantMark = (supplier?.name ?? 'SU').slice(0, 2).toUpperCase();

  return (
    <div id="sp-root">
      <div className="sp-shell">
        {/* Sidebar */}
        <aside className="sp-sidebar">
          <div className="sp-sidebar-logo">
            <img src="/assets/images/cargo_merged_originalmark_syne800_true.png" alt="Cargo" />
          </div>

          <nav className="sp-sidebar-nav">
            {NAV_GROUPS.map((group) => (
              <div key={group.label} className="sp-nav-group">
                <div className="sp-nav-group-label">{group.label}</div>
                {group.items.map(({ to, icon: Icon, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) => `sp-nav-item${isActive ? ' active' : ''}`}
                  >
                    <Icon />
                    <span>{label}</span>
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>

          <div className="sp-sidebar-foot">
            <div className="sp-avatar">{initials}</div>
            <div style={{ minWidth: 0 }}>
              <div className="sp-who-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {displayName}
              </div>
              <div className="sp-who-role">Account</div>
            </div>
            <button onClick={handleLogout} title="Log out" aria-label="Log out">
              <LogOut size={14} />
            </button>
          </div>
        </aside>

        {/* Main area */}
        <div className="sp-main">
          <header className="sp-topbar">
            <div className="sp-topbar-search">
              <Search />
              <input placeholder="Search orders, products, clients…" />
              <span className="sp-kbd">⌘K</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
<button className="sp-icon-btn" aria-label="Help">
                <HelpCircle />
              </button>
              <button className="sp-icon-btn" aria-label="Notifications">
                <Bell />
                <span className="sp-notify-dot" />
              </button>

              {/* Workspace card */}
              <button
                onClick={() => navigate('/supplier/settings')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '6px 12px', borderRadius: 10,
                  border: '1px solid #e2e8f0', background: 'transparent',
                  cursor: 'pointer', marginLeft: 6,
                  transition: 'background 120ms',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#f0f4ff'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                aria-label="Workspace settings"
              >
                {/* Logo */}
                {WORKSPACE_CONFIG.logoUrl ? (
                  <img
                    src={WORKSPACE_CONFIG.logoUrl}
                    alt="logo"
                    style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                  />
                ) : (
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                    background: 'linear-gradient(135deg, #e0e7ff, #c7d2fe)',
                    border: '1.5px dashed #818cf8',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'Outfit', fontWeight: 700, fontSize: 9,
                    letterSpacing: '0.1em', color: '#818cf8',
                  }}>LOGO</div>
                )}

                {/* Name + subtitle */}
                <div style={{ textAlign: 'left', minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: '#1e293b', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                    {supplier?.name ?? 'Source and Supply'}
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.3 }}>Supplier workspace</div>
                </div>

                {/* Avatar stack */}
                <div style={{ display: 'flex', alignItems: 'center', marginLeft: 2 }}>
                  {WORKSPACE_CONFIG.members.map((m, i) => (
                    <div key={i} style={{
                      width: 20, height: 20, borderRadius: '50%',
                      background: m.bg, color: '#fff',
                      border: '2px solid #fff',
                      marginLeft: i === 0 ? 0 : -6,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'Outfit', fontWeight: 700, fontSize: 7.5,
                      flexShrink: 0, zIndex: WORKSPACE_CONFIG.members.length - i,
                    }}>{m.initials}</div>
                  ))}
                </div>

                <ChevronRight size={14} style={{ color: '#94a3b8', flexShrink: 0 }} />
              </button>
            </div>
          </header>

          <div className="sp-content">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SupplierLayout;

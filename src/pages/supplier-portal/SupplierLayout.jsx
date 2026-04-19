import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingBag, Truck, FileText, BookOpen, Tag,
  Users, MessageSquare, RotateCcw, Settings, LogOut,
  Bell, Search, HelpCircle,
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useSupplier } from '../../contexts/SupplierContext';
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

          <div className="sp-sidebar-who">
            <div className="sp-tenant-mark">{tenantMark}</div>
            <div style={{ minWidth: 0 }}>
              <div className="sp-tenant-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {supplier?.name ?? 'Supplier'}
              </div>
              <div className="sp-tenant-sub">Supplier workspace</div>
            </div>
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

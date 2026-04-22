import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingBag, Truck, FileText, BookOpen, Tag,
  Users, MessageSquare, RotateCcw, Bell, Search,
} from 'lucide-react';
import SupplierAvatarMenu from './components/SupplierAvatarMenu';
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
    ],
  },
];

const SupplierLayout = () => (
  <div id="sp-root">
    <div className="sp-shell">
      {/* Sidebar */}
      <aside className="sp-sidebar">
        <div className="sp-sidebar-logo">
          <img src="/centered-logo.svg" alt="Cargo" />
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

        {/* Side-foot — avatar menu is in topbar, so just show a thin footer */}
        <div style={{ marginTop: 'auto', padding: '14px 10px 4px', borderTop: '1px solid var(--line-soft)' }} />
      </aside>

      {/* Main area */}
      <div className="sp-main">
        <header className="sp-topbar">
          <div className="sp-topbar-search">
            <Search />
            <input placeholder="Search orders, products, clients…" />
            <span className="sp-kbd">⌘K</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            {/* Bell — static (no notifications table yet) */}
            <button className="sp-icon-btn" aria-label="Notifications">
              <Bell />
            </button>

            {/* Avatar dropdown */}
            <SupplierAvatarMenu />
          </div>
        </header>

        <div className="sp-content">
          <Outlet />
        </div>
      </div>
    </div>
  </div>
);

export default SupplierLayout;

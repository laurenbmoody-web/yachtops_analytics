import React, { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingBag, Truck, FileText, BookOpen, Tag,
  Users, MessageSquare, RotateCcw, Bell, Search,
} from 'lucide-react';
import SupplierAvatarMenu from './components/SupplierAvatarMenu';
import { useTier, hasClientPermission } from '../../contexts/SupplierPermissionContext';
import { useSupplier } from '../../contexts/SupplierContext';
import { fetchUnactionedReturnsCount } from './utils/supplierReturnTasks';
import { fetchVesselRevisedCount, fetchVesselRevisedLines } from './utils/supplierStorage';
import './supplier-portal.css';

// `requires` gates each nav item via hasClientPermission. Items without
// `requires` are visible to every active team member (Overview, Returns,
// Price-lists placeholder).
const NAV_GROUPS = [
  {
    label: 'Work',
    items: [
      { to: '/supplier/overview',   icon: LayoutDashboard, label: 'Overview' },
      { to: '/supplier/orders',     icon: ShoppingBag,     label: 'Orders',    requires: 'orders:view' },
      { to: '/supplier/deliveries', icon: Truck,           label: 'Deliveries', requires: 'deliveries:view' },
      { to: '/supplier/invoices',   icon: FileText,        label: 'Invoices',  requires: 'invoices:view' },
    ],
  },
  {
    label: 'Catalogue',
    items: [
      { to: '/supplier/products',    icon: BookOpen, label: 'Products',    requires: 'catalogue:view' },
      { to: '/supplier/price-lists', icon: Tag,      label: 'Price lists' },
    ],
  },
  {
    label: 'Relationships',
    items: [
      { to: '/supplier/clients',  icon: Users,         label: 'Yacht clients', requires: 'clients:view' },
      { to: '/supplier/messages', icon: MessageSquare, label: 'Messages',      requires: 'messages:view' },
      { to: '/supplier/returns',  icon: RotateCcw,     label: 'Returns' },
    ],
  },
];

const SupplierLayout = () => {
  const { tier } = useTier();
  const { supplier } = useSupplier();
  const navigate = useNavigate();
  const bellRef = useRef(null);
  const [bellOpen, setBellOpen] = useState(false);
  const [revisedLines, setRevisedLines] = useState([]);
  // Count of unactioned ('sent') return tasks for the /supplier/returns
  // nav badge. 'sent' is the unread state — naturally cleared when the
  // supplier clicks Acknowledge. Re-fetches on mount, window focus, and
  // when SupplierReturns dispatches `supplier-return-tasks-changed`
  // after a local action.
  const [returnsCount, setReturnsCount] = useState(0);
  useEffect(() => {
    if (!supplier?.id) return undefined;
    let cancelled = false;
    const refresh = () => {
      fetchUnactionedReturnsCount(supplier.id)
        .then((n) => { if (!cancelled) setReturnsCount(n); })
        .catch((e) => console.error('[SupplierLayout returns badge]', e));
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('supplier-return-tasks-changed', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('supplier-return-tasks-changed', refresh);
    };
  }, [supplier?.id]);

  // Bell badge — counts supplier_order_items still in 'pending' with
  // revised_at set (i.e. the vessel reopened them after the supplier
  // had confirmed). Same refresh triggers as the returns badge plus
  // a 'supplier-order-items-changed' window event so any in-portal
  // confirm action drops the badge live.
  const [revisedCount, setRevisedCount] = useState(0);
  useEffect(() => {
    if (!supplier?.id) return undefined;
    let cancelled = false;
    const refresh = () => {
      fetchVesselRevisedCount()
        .then((n) => { if (!cancelled) setRevisedCount(n); })
        .catch((e) => console.error('[SupplierLayout revised badge]', e));
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('supplier-order-items-changed', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('supplier-order-items-changed', refresh);
    };
  }, [supplier?.id]);

  // Fetch the actual revised lines when the bell dropdown opens — kept
  // separate from the count poll so we don't pay for the full list on
  // every focus/event. Refetches on each open so it's always current.
  useEffect(() => {
    if (!bellOpen) return undefined;
    let cancelled = false;
    fetchVesselRevisedLines()
      .then((rows) => { if (!cancelled) setRevisedLines(rows); })
      .catch((e) => console.error('[SupplierLayout bell dropdown]', e));
    return () => { cancelled = true; };
  }, [bellOpen]);

  // Close the bell dropdown on outside click or Escape.
  useEffect(() => {
    if (!bellOpen) return undefined;
    const onDocClick = (e) => {
      if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setBellOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [bellOpen]);

  const openOrderForLine = (line) => {
    setBellOpen(false);
    if (line?.order_id) navigate(`/supplier/orders/${line.order_id}`);
  };

  const visibleGroups = NAV_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.requires || hasClientPermission(tier, item.requires)),
    }))
    .filter((group) => group.items.length > 0);

  return (
  <div id="sp-root">
    <div className="sp-shell">
      {/* Sidebar */}
      <aside className="sp-sidebar">
        <div className="sp-sidebar-logo">
          <img src="/centered-logo.svg" alt="Cargo" />
        </div>

        <nav className="sp-sidebar-nav">
          {visibleGroups.map((group) => (
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
                  {to === '/supplier/returns' && returnsCount > 0 && (
                    <span className="sp-nav-item-badge" aria-label={`${returnsCount} unactioned return${returnsCount === 1 ? '' : 's'}`}>
                      {returnsCount}
                    </span>
                  )}
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
            {/* Bell — wired to the vessel-revised count. Click opens
                a small dropdown listing the affected lines so the
                supplier can jump straight to the parent order. When
                nothing is waiting, the bell is still clickable but
                the panel reads "No new notifications". */}
            <div ref={bellRef} style={{ position: 'relative' }}>
              <button
                type="button"
                className={`sp-icon-btn sp-bell-btn${revisedCount > 0 ? ' has-badge' : ''}`}
                aria-label={revisedCount > 0
                  ? `${revisedCount} line${revisedCount === 1 ? '' : 's'} reopened by vessel — review required`
                  : 'Notifications'}
                aria-haspopup="true"
                aria-expanded={bellOpen}
                onClick={() => setBellOpen((v) => !v)}
              >
                <Bell />
                {revisedCount > 0 && (
                  <span className="sp-bell-badge" aria-hidden="true">{revisedCount > 9 ? '9+' : revisedCount}</span>
                )}
              </button>
              {bellOpen && (
                <div className="sp-bell-panel" role="dialog" aria-label="Notifications">
                  <div className="sp-bell-panel-head">
                    <span className="sp-bell-panel-eyebrow">Notifications</span>
                    {revisedCount > 0 && (
                      <span className="sp-bell-panel-count">{revisedCount} waiting</span>
                    )}
                  </div>
                  {revisedLines.length === 0 ? (
                    <div className="sp-bell-panel-empty">
                      No new notifications. You'll see vessel-reopened lines here when they need a re-confirm.
                    </div>
                  ) : (
                    <ul className="sp-bell-panel-list">
                      {revisedLines.map((line) => {
                        const vessel = line.supplier_orders?.vessel_name
                          || line.supplier_orders?.yacht_name
                          || 'Vessel';
                        return (
                          <li key={line.id}>
                            <button
                              type="button"
                              className="sp-bell-panel-item"
                              onClick={() => openOrderForLine(line)}
                            >
                              <span className="sp-bell-panel-item-dot" />
                              <span className="sp-bell-panel-item-body">
                                <span className="sp-bell-panel-item-name">{line.item_name}</span>
                                <span className="sp-bell-panel-item-meta">
                                  {vessel}
                                  {line.quantity != null && (<> · {line.quantity}{line.unit ? ` ${line.unit}` : ''}</>)}
                                </span>
                              </span>
                              <span className="sp-bell-panel-item-tag">Revised</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>

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
};

export default SupplierLayout;

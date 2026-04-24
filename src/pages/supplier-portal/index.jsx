import React, { useState, useMemo } from 'react';
import {
  Inbox, Truck, FileText, Package, List, Ship, MessageSquare,
  RotateCcw, Settings, Search, Bell, HelpCircle,
  ChevronDown, BarChart2,
} from 'lucide-react';
import { useSupplier } from '../../contexts/SupplierContext';
import { hasClientPermission } from '../../contexts/SupplierPermissionContext';
import './supplier-portal.css';

import SupplierOverview    from './views/SupplierOverview';
import SupplierOrders      from './views/SupplierOrders';
import SupplierOrderDetail from './views/SupplierOrderDetail';
import SupplierProducts    from './views/SupplierProducts';
import SupplierDeliveries  from './views/SupplierDeliveries';
import SupplierInvoices    from './views/SupplierInvoices';
import SupplierClients     from './views/SupplierClients';
import SupplierMessages    from './views/SupplierMessages';
import SupplierReturns     from './views/SupplierReturns';
import SupplierSettings    from './views/SupplierSettings';

// `requires` gates visibility via hasClientPermission(tier, action).
// Items without `requires` are visible to all active team members.
const NAV = [
  { group: 'WORK', items: [
    { id: 'dashboard',  label: 'Overview',        icon: BarChart2 },
    { id: 'orders',     label: 'Orders',          icon: Inbox,        requires: 'orders:view' },
    { id: 'deliveries', label: 'Deliveries',      icon: Truck,        requires: 'deliveries:view' },
    { id: 'invoices',   label: 'Invoices',        icon: FileText,     requires: 'invoices:view' },
  ]},
  { group: 'CATALOGUE', items: [
    { id: 'catalogue',  label: 'Products',        icon: Package,      requires: 'catalogue:view' },
    { id: 'pricelists', label: 'Price lists',     icon: List, disabled: true },
  ]},
  { group: 'RELATIONSHIPS', items: [
    { id: 'clients',    label: 'Yacht clients',   icon: Ship,         requires: 'clients:view' },
    { id: 'messages',   label: 'Messages',        icon: MessageSquare,requires: 'messages:view' },
  ]},
  { group: '', items: [
    { id: 'returns',    label: 'Returns & Issues', icon: RotateCcw },
    { id: 'settings',   label: 'Settings',         icon: Settings },
  ]},
];

const initialsFrom = (name) => {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const SupplierPortal = () => {
  const { supplier, contact, loading: supplierLoading, error: supplierError } = useSupplier();
  const tier = contact?.permission_tier ?? null;

  const [view, setView]                   = useState('dashboard');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [darkSidebar]                     = useState(false);
  const [confirmed, setConfirmed]         = useState(false);

  const brandName = supplier?.name ?? '—';
  const brandMark = useMemo(() => initialsFrom(supplier?.name), [supplier?.name]);

  const openOrder = (id) => { setSelectedOrder(id); setView('detail'); setConfirmed(false); };
  const goBack    = ()   => { setView('orders'); setSelectedOrder(null); };

  const renderView = () => {
    switch (view) {
      case 'dashboard':   return <SupplierOverview />;
      case 'orders':      return <SupplierOrders onOpenOrder={openOrder} />;
      case 'detail':      return <SupplierOrderDetail orderId={selectedOrder} onBack={goBack} confirmed={confirmed} onConfirm={() => setConfirmed(true)} />;
      case 'catalogue':   return <SupplierProducts />;
      case 'deliveries':  return <SupplierDeliveries />;
      case 'invoices':    return <SupplierInvoices />;
      case 'clients':     return <SupplierClients />;
      case 'messages':    return <SupplierMessages onOpenOrder={openOrder} />;
      case 'returns':     return <SupplierReturns />;
      case 'settings':    return <SupplierSettings />;
      default:            return <SupplierOverview />;
    }
  };

  if (supplierLoading) {
    return (
      <div id="sp-root">
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>
          Loading your supplier workspace…
        </div>
      </div>
    );
  }

  if (supplierError || !supplier) {
    return (
      <div id="sp-root">
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 28 }}>⚠️</div>
          <div style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: 18, color: 'var(--fg)' }}>
            We couldn't load your supplier workspace
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted-s)', maxWidth: 420, lineHeight: 1.5 }}>
            {supplierError ?? 'Your supplier profile could not be loaded.'}
          </div>
          <button
            className="sp-pill primary"
            style={{ padding: '9px 20px' }}
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div id="sp-root">

      {/* Sidebar */}
      <aside className={`sp-sidebar${darkSidebar ? ' dark' : ''}`}>
        {/* Brand */}
        <div className="sp-brand">
          <div className="sp-tenant-mark">{brandMark}</div>
          <div>
            <div className="sp-tenant-name">{brandName}</div>
            <div className="sp-tenant-sub">Supplier</div>
          </div>
          <ChevronDown size={14} style={{ marginLeft: 'auto', color: 'var(--muted)', flexShrink: 0 }} />
        </div>

        {/* Nav */}
        {NAV.map((section, si) => (
          <div key={si} className="sp-nav-section">
            {section.group && <div className="sp-nav-label">{section.group}</div>}
            {section.items
              .filter(item => !item.requires || hasClientPermission(tier, item.requires))
              .map(item => {
              const Icon = item.icon;
              const isActive = view === item.id || (view === 'detail' && item.id === 'orders');
              return (
                <button
                  key={item.id}
                  className={`sp-nav-item${isActive ? ' active' : ''}`}
                  onClick={() => !item.disabled && setView(item.id)}
                  style={{ opacity: item.disabled ? 0.45 : 1 }}
                >
                  <Icon size={15} />
                  {item.label}
                </button>
              );
            })}
          </div>
        ))}
      </aside>

      {/* Main */}
      <div className="sp-main">
        {/* Topbar */}
        <div className="sp-topbar">
          <Search size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
          <div className="sp-search" style={{ marginLeft: 0 }}>
            <Search size={13} style={{ color: 'var(--muted)', flexShrink: 0 }} />
            <input placeholder="Search orders, yachts, products…" />
            <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: 'var(--muted)', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 4, padding: '1px 5px' }}>⌘K</span>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="sp-icon-btn"><HelpCircle size={14} /></button>
            <button className="sp-icon-btn"><Bell size={14} /></button>
          </div>
        </div>

        {/* Content */}
        <div className="sp-content">
          {renderView()}
        </div>
      </div>
    </div>
  );
};

export default SupplierPortal;

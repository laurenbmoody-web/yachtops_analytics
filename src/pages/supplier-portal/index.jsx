import React, { useState } from 'react';
import {
  Inbox, Truck, FileText, Package, List, Ship, MessageSquare,
  RotateCcw, Settings, Search, Bell, HelpCircle, LayoutGrid,
  ChevronDown, BarChart2,
} from 'lucide-react';
import './supplier-portal.css';

import DashboardView   from './views/DashboardView';
import OrdersView      from './views/OrdersView';
import OrderDetailView from './views/OrderDetailView';
import CatalogueView   from './views/CatalogueView';
import DeliveriesView  from './views/DeliveriesView';
import InvoicesView    from './views/InvoicesView';
import ClientsView     from './views/ClientsView';
import MessagesView    from './views/MessagesView';
import ReturnsView     from './views/ReturnsView';
import SettingsView    from './views/SettingsView';

const NAV = [
  { group: 'WORK', items: [
    { id: 'dashboard',  label: 'Overview',      icon: BarChart2 },
    { id: 'orders',     label: 'Orders',         icon: Inbox,        badge: '4', urgent: true },
    { id: 'deliveries', label: 'Deliveries',     icon: Truck,        badge: '7' },
    { id: 'invoices',   label: 'Invoices',       icon: FileText,     badge: '2' },
  ]},
  { group: 'CATALOGUE', items: [
    { id: 'catalogue',  label: 'Products',       icon: Package },
    { id: 'pricelists', label: 'Price lists',    icon: List, disabled: true },
  ]},
  { group: 'RELATIONSHIPS', items: [
    { id: 'clients',    label: 'Yacht clients',  icon: Ship },
    { id: 'messages',   label: 'Messages',       icon: MessageSquare, badge: '3' },
  ]},
  { group: '', items: [
    { id: 'returns',    label: 'Returns & Issues', icon: RotateCcw },
    { id: 'settings',   label: 'Settings',          icon: Settings },
  ]},
];

const SupplierPortal = () => {
  const [view, setView]               = useState('orders');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [darkSidebar, setDarkSidebar] = useState(false);
  const [confirmed, setConfirmed]     = useState(false);

  const openOrder = (id) => { setSelectedOrder(id); setView('detail'); setConfirmed(false); };
  const goBack    = ()   => { setView('orders'); setSelectedOrder(null); };

  const renderView = () => {
    switch (view) {
      case 'dashboard':   return <DashboardView   onOpenOrder={openOrder} onNav={setView} />;
      case 'orders':      return <OrdersView       onOpenOrder={openOrder} />;
      case 'detail':      return <OrderDetailView  orderId={selectedOrder} onBack={goBack} confirmed={confirmed} onConfirm={() => setConfirmed(true)} />;
      case 'catalogue':   return <CatalogueView />;
      case 'deliveries':  return <DeliveriesView />;
      case 'invoices':    return <InvoicesView />;
      case 'clients':     return <ClientsView />;
      case 'messages':    return <MessagesView onOpenOrder={openOrder} />;
      case 'returns':     return <ReturnsView />;
      case 'settings':    return <SettingsView />;
      default:            return <OrdersView onOpenOrder={openOrder} />;
    }
  };

  return (
    <div id="sp-root">

      {/* Sidebar */}
      <aside className={`sp-sidebar${darkSidebar ? ' dark' : ''}`}>
        {/* Brand */}
        <div className="sp-brand">
          <div className="sp-tenant-mark">MP</div>
          <div>
            <div className="sp-tenant-name">Maison Provence</div>
            <div className="sp-tenant-sub">Antibes · Supplier</div>
          </div>
          <ChevronDown size={14} style={{ marginLeft: 'auto', color: 'var(--muted)', flexShrink: 0 }} />
        </div>

        {/* Nav */}
        {NAV.map((section, si) => (
          <div key={si} className="sp-nav-section">
            {section.group && <div className="sp-nav-label">{section.group}</div>}
            {section.items.map(item => {
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
                  {item.badge && (
                    <span className={`sp-nav-badge${item.urgent ? ' urgent' : ''}`}>
                      {item.badge}
                    </span>
                  )}
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
            <span className="sp-badge">SANDBOX</span>
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

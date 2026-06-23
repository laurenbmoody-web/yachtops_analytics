import React from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';

// InboxSidebar — the navigation rail for the inbox surface.
//
// Categories with a `to` route become live navigation; categories
// without one stay as dimmed "soon" placeholders that scaffold the
// future inbox so the visual rhythm doesn't shift each time a new
// surface lights up. Active state comes from the parent via
// `activeCategory`. Counts can be supplied per-category.

// One category row. `active` paints the navy-tinted selection; missing
// `to` dims it and swaps the right-hand slot for the "soon" tag. The
// live badge renders when `count` is provided.
function SidebarItem({ icon, label, to, active = false, count, onNavigate }) {
  const placeholder = !to;
  const className = [
    'rv-sb-item',
    active && 'active',
    placeholder && 'placeholder',
  ].filter(Boolean).join(' ');

  const handleClick = () => { if (to && !active) onNavigate(to); };
  const handleKey = (e) => {
    if (!to || active) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate(to); }
  };

  return (
    <div
      className={className}
      role={placeholder ? undefined : 'button'}
      tabIndex={placeholder ? undefined : 0}
      aria-current={active ? 'page' : undefined}
      aria-label={active ? `${label}, current view` : label}
      onClick={handleClick}
      onKeyDown={handleKey}
    >
      <Icon name={icon} size={16} />
      <span className="rv-sb-item-label">{label}</span>
      {placeholder ? (
        <span className="rv-sb-soon">soon</span>
      ) : count != null ? (
        <span className="rv-sb-badge" aria-live="polite">{count}</span>
      ) : null}
    </div>
  );
}

export default function InboxSidebar({ activeCategory = 'rotas', counts = {} }) {
  const navigate = useNavigate();
  const go = (to) => navigate(to);

  return (
    <aside className="rv-sidebar" aria-label="Inbox navigation">
      <div className="rv-sb-header">
        <div className="rv-sb-title">Inbox</div>
        <div className="rv-sb-subtitle">All your work</div>
      </div>

      <div className="rv-sb-section">
        <div className="rv-sb-section-head">Reviews</div>
        <SidebarItem
          icon="Inbox"
          label="Rota submissions"
          to="/reviews/rotas"
          active={activeCategory === 'rotas'}
          count={counts.rotas}
          onNavigate={go}
        />
        <SidebarItem
          icon="ShoppingCart"
          label="Order approvals"
          to="/reviews/orders"
          active={activeCategory === 'orders'}
          count={counts.orders}
          onNavigate={go}
        />
        <SidebarItem
          icon="PenLine"
          label="Sea-time sign-off"
          to="/reviews/seatime"
          active={activeCategory === 'seatime'}
          count={counts.seatime}
          onNavigate={go}
        />
        <SidebarItem icon="Undo2" label="Supplier returns" />
        <SidebarItem icon="Receipt" label="Expense approvals" />
      </div>

      <div className="rv-sb-section">
        <div className="rv-sb-section-head">Messages</div>
        <SidebarItem icon="MessageSquare" label="Direct messages" />
        <SidebarItem icon="Users" label="Department channels" />
      </div>

      <div className="rv-sb-section">
        <div className="rv-sb-section-head">Archive</div>
        <SidebarItem icon="Archive" label="Resolved" />
      </div>
    </aside>
  );
}

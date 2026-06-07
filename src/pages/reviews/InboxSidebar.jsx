import React from 'react';
import Icon from '../../components/AppIcon';

// InboxSidebar — the navigation rail for the inbox surface.
//
// Phase 4a-polish: "Rota submissions" is the only live category; every
// other row is a dimmed placeholder ("soon") that scaffolds the future
// inbox so later categories slot in without a re-design. Placeholders are
// intentionally non-interactive — cursor: default, no handler, no hover —
// which is what makes their not-yet-shipped state legible.

// One category row. `active` paints the navy-tinted selection; `placeholder`
// dims it and swaps the right-hand slot for the "soon" tag. The live badge
// renders for the active category when `count` is provided.
function SidebarItem({ icon, label, active = false, placeholder = false, count }) {
  const className = [
    'rv-sb-item',
    active && 'active',
    placeholder && 'placeholder',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={className}
      role={placeholder ? undefined : 'button'}
      tabIndex={placeholder ? undefined : 0}
      aria-current={active ? 'page' : undefined}
      aria-label={active ? `${label}, current view` : label}
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

export default function InboxSidebar({ count }) {
  return (
    <aside className="rv-sidebar" aria-label="Inbox navigation">
      <div className="rv-sb-header">
        <div className="rv-sb-title">Inbox</div>
        <div className="rv-sb-subtitle">All your work</div>
      </div>

      <div className="rv-sb-section">
        <div className="rv-sb-section-head">Reviews</div>
        <SidebarItem icon="Inbox" label="Rota submissions" active count={count} />
        <SidebarItem icon="ShoppingCart" label="Order approvals" placeholder />
        <SidebarItem icon="Undo2" label="Supplier returns" placeholder />
        <SidebarItem icon="Receipt" label="Expense approvals" placeholder />
      </div>
    </aside>
  );
}

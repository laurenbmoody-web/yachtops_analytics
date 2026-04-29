import React from 'react';

/**
 * EditorialTabNav — tracked uppercase tab nav with terracotta active
 * underline. Replaces the bottom-border-blue active state used elsewhere.
 *
 *   <EditorialTabNav
 *     tabs={[
 *       { id: 'items', label: 'Items' },
 *       { id: 'orders', label: 'Orders' },
 *     ]}
 *     activeTab={activeTab}
 *     onTabChange={setActiveTab}
 *   />
 *
 * Styling lives in pantry.css under `.editorial-tab-nav` so it inherits
 * the same token scope (`#pantry-root, .editorial-page`) as the rest of
 * the editorial language.
 */
export default function EditorialTabNav({
  tabs = [],
  activeTab,
  onTabChange,
  ariaLabel = 'Sections',
}) {
  return (
    <nav className="editorial-tab-nav" aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange?.(tab.id)}
            className={`editorial-tab${isActive ? ' editorial-tab-active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

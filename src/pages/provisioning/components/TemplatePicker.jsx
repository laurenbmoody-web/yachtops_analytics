import React, { useState } from 'react';
import { TEMPLATES } from '../data/templates';

// ── TemplatePicker ─────────────────────────────────────────────────────────
// Modal that lets the user pick a preset template and applies it to a new board.
// Props:
//   boardType   — currently selected board_type (e.g. 'charter') for pre-filtering
//   guestCount  — number of active guests on the linked trip (used to scale quantities)
//   onUse(items) — called with scaled item array when "Use Template" is clicked
//   onBack       — called when user clicks ← Back

export default function TemplatePicker({ boardType, guestCount = 0, onUse, onBack }) {
  const [activeFilter, setActiveFilter] = useState(boardType || 'all');
  const [selected, setSelected] = useState(null);

  // Sprint 9c.1a.1: canonical 7-value enum is charter, owner, yard,
  // crossing, crew, standby, general. Shipyard merged into yard. Picker
  // surfaces a representative subset — full filter list lives in BOARD_TYPES.
  const filters = [
    { value: 'all',     label: 'All' },
    { value: 'charter', label: 'Charter' },
    { value: 'owner',   label: 'Owner' },
    { value: 'yard',    label: 'Yard' },
    { value: 'general', label: 'General' },
  ];

  const visible = TEMPLATES.filter(t =>
    activeFilter === 'all' || t.boardTypes.includes(activeFilter)
  );

  const handleUse = () => {
    if (!selected) return;
    const tpl = TEMPLATES.find(t => t.id === selected);
    if (!tpl) return;

    const items = tpl.items.map(item => {
      let qty = 1;
      if (item.default_qty_flat != null) {
        qty = item.default_qty_flat;
      } else if (item.default_qty_per_guest != null && guestCount > 0) {
        qty = Math.max(1, Math.ceil(item.default_qty_per_guest * guestCount));
      } else if (item.default_qty_per_guest != null) {
        qty = Math.max(1, Math.ceil(item.default_qty_per_guest));
      }
      return {
        name:             item.name,
        category:         item.category,
        unit:             item.unit || null,
        quantity_ordered: qty,
        status:           'draft',
        department:       tpl.department,
      };
    });

    onUse(items);
  };

  const selectedTpl = selected ? TEMPLATES.find(t => t.id === selected) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header — back + title with orange dot. Inherits .pv-wizard
          tokens from the wrapper in NewBoardColumn. */}
      <div className="pv-wizard-header" style={{ marginBottom: 14 }}>
        <button onClick={onBack} className="pv-wizard-back">← Back</button>
        <h3 className="pv-wizard-title">
          <span className="pv-wizard-title-dot" aria-hidden="true" />
          Choose a template
        </h3>
      </div>

      {/* Filter pills */}
      <div className="pv-wizard-pill-row" style={{ marginBottom: 12 }}>
        {filters.map(f => (
          <button
            key={f.value}
            onClick={() => setActiveFilter(f.value)}
            className={`pv-wizard-pill${activeFilter === f.value ? ' is-active' : ''}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Template list */}
      <div className="pv-wizard-list">
        {visible.length === 0 && (
          <p className="pv-wizard-empty">No templates for this type.</p>
        )}
        {visible.map(tpl => {
          const isSelected = selected === tpl.id;
          return (
            <button
              key={tpl.id}
              onClick={() => setSelected(isSelected ? null : tpl.id)}
              className={`pv-wizard-pick-card${isSelected ? ' is-selected' : ''}`}
            >
              <div className="pv-wizard-pick-card-head">
                <p className="pv-wizard-pick-card-title">{tpl.name}</p>
                <span className="pv-wizard-item-count">{tpl.itemCount} items</span>
              </div>
              <p className="pv-wizard-pick-card-desc">{tpl.description}</p>
              <div className="pv-wizard-chip-row">
                {tpl.categories.slice(0, 4).map(cat => (
                  <span key={cat} className="pv-wizard-chip">{cat}</span>
                ))}
                {tpl.categories.length > 4 && (
                  <span className="pv-wizard-chip-more">+{tpl.categories.length - 4} more</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* CTA */}
      <div className="pv-wizard-cta-footer">
        {selectedTpl && guestCount > 0 && (
          <p className="pv-wizard-cta-footer-note">
            Quantities scaled for <strong>{guestCount} guests</strong>
          </p>
        )}
        <button
          onClick={handleUse}
          disabled={!selected}
          className="pv-wizard-btn pv-wizard-btn-primary is-block"
        >
          {selected
            ? `Use Template (${selectedTpl?.itemCount ?? 0} items)`
            : 'Select a template'}
        </button>
      </div>
    </div>
  );
}

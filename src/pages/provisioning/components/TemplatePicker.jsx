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

  const filters = [
    { value: 'all',       label: 'All' },
    { value: 'charter',   label: 'Charter' },
    { value: 'owner',     label: 'Owner' },
    { value: 'shipyard',  label: 'Shipyard' },
    { value: 'general',   label: 'General' },
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
        status:           'pending',
        department:       tpl.department,
      };
    });

    onUse(items);
  };

  const selectedTpl = selected ? TEMPLATES.find(t => t.id === selected) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: '2px 4px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 3 }}
        >
          ← Back
        </button>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>Choose a template</span>
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {filters.map(f => (
          <button
            key={f.value}
            onClick={() => setActiveFilter(f.value)}
            style={{
              padding: '4px 12px', borderRadius: 20, border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 600,
              background: activeFilter === f.value ? '#1E3A5F' : '#F1F5F9',
              color: activeFilter === f.value ? 'white' : '#64748B',
              transition: 'all 0.15s',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Template list */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 2 }}>
        {visible.length === 0 && (
          <p style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', marginTop: 20 }}>
            No templates for this type.
          </p>
        )}
        {visible.map(tpl => {
          const isSelected = selected === tpl.id;
          return (
            <button
              key={tpl.id}
              onClick={() => setSelected(isSelected ? null : tpl.id)}
              style={{
                textAlign: 'left', padding: '10px 12px', borderRadius: 10,
                border: isSelected ? '1.5px solid #1E3A5F' : '1px solid #E2E8F0',
                background: isSelected ? '#EFF6FF' : 'white',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#0F172A' }}>{tpl.name}</p>
                <span style={{ fontSize: 10, color: '#94A3B8', whiteSpace: 'nowrap', marginLeft: 8 }}>{tpl.itemCount} items</span>
              </div>
              <p style={{ margin: '3px 0 6px', fontSize: 11, color: '#64748B', lineHeight: 1.4 }}>{tpl.description}</p>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {tpl.categories.slice(0, 4).map(cat => (
                  <span key={cat} style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 10, background: '#F1F5F9', color: '#475569' }}>
                    {cat}
                  </span>
                ))}
                {tpl.categories.length > 4 && (
                  <span style={{ fontSize: 9, color: '#94A3B8' }}>+{tpl.categories.length - 4} more</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* CTA */}
      <div style={{ paddingTop: 10, borderTop: '1px solid #F1F5F9', marginTop: 10 }}>
        {selectedTpl && guestCount > 0 && (
          <p style={{ margin: '0 0 8px', fontSize: 11, color: '#64748B', textAlign: 'center' }}>
            Quantities scaled for <strong>{guestCount} guests</strong>
          </p>
        )}
        <button
          onClick={handleUse}
          disabled={!selected}
          style={{
            width: '100%', padding: '9px 0', borderRadius: 8, border: 'none', cursor: selected ? 'pointer' : 'default',
            background: selected ? '#1E3A5F' : '#E2E8F0',
            color: selected ? 'white' : '#94A3B8',
            fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
          }}
        >
          {selected
            ? `Use Template (${selectedTpl?.itemCount ?? 0} items)`
            : 'Select a template'}
        </button>
      </div>
    </div>
  );
}

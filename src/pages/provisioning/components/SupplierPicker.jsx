// Structured supplier_profiles combobox — Sprint 9c.3 Phase 8.
//
// Searchable single-select over active (non-archived) supplier
// profiles. Shared by ItemDrawer (item-level supplier) and
// SendToSupplierModal's "Unassigned" bucket. Optional inline
// "+ add new" (used by the modal; ItemDrawer doesn't pass it).
//
// Accepts either the vendor shape (business_city/business_country)
// or the legacy-mapped shape (port_location) for the location line.
//
// Props:
//   value          supplier_profile_id | '' (selected id)
//   suppliers      array of { id, name, business_city?,
//                              business_country?, port_location? }
//   disabled       bool
//   placeholder    string (default "No supplier")
//   inputClassName host input class so it matches the surrounding form
//   onChange(profile|null)  — fires on pick / clear
//   allowAddNew    bool
//   onAddNew(name) -> Promise<profile|null>  — inline create

import React, { useState } from 'react';

const locationOf = (s) =>
  [s.business_city || s.port_location, s.business_country]
    .filter(Boolean)
    .join(', ');

const SupplierPicker = ({
  value,
  suppliers = [],
  disabled = false,
  placeholder = 'No supplier',
  inputClassName = '',
  onChange,
  allowAddNew = false,
  onAddNew,
}) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);

  const selected = suppliers.find((s) => s.id === value) || null;
  const selectedName = selected?.name || '';

  const q = query.trim().toLowerCase();
  const opts = suppliers.filter((s) => !q || (s.name || '').toLowerCase().includes(q));
  const exactMatch = suppliers.some((s) => (s.name || '').toLowerCase() === q);
  const showAddRow = allowAddNew && !!onAddNew && q.length > 0 && !exactMatch;

  const pick = (profile) => {
    onChange(profile);
    setOpen(false);
    setQuery('');
  };

  const handleAddNew = async () => {
    const name = query.trim();
    if (!name || addBusy) return;
    setAddBusy(true);
    try {
      const profile = await onAddNew(name);
      if (profile) pick(profile);
      else { setOpen(false); setQuery(''); }
    } finally {
      setAddBusy(false);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        value={open ? query : selectedName}
        onFocus={() => { if (disabled) return; setQuery(''); setOpen(true); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 140)}
        className={inputClassName}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
      />
      {open && !disabled && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
            zIndex: 50, maxHeight: 240, overflowY: 'auto',
            background: '#fff', border: '1px solid #E5E7EB',
            borderRadius: 10, boxShadow: '0 10px 28px rgba(26,29,63,0.16)',
          }}
        >
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); pick(null); }}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '9px 12px', fontSize: 13, background: 'transparent',
              border: 0, cursor: 'pointer',
              color: !value ? '#C65A1A' : '#262A53',
              fontWeight: !value ? 600 : 400,
            }}
          >
            {placeholder}
          </button>

          {opts.map((s) => {
            const on = s.id === value;
            const loc = locationOf(s);
            return (
              <button
                key={s.id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(s); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '9px 12px', background: on ? '#FAEEDA' : 'transparent',
                  border: 0, borderTop: '1px solid #EEF0F4', cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 13, color: on ? '#C65A1A' : '#262A53', fontWeight: on ? 600 : 500 }}>
                  {s.name}
                </div>
                {loc && <div style={{ fontSize: 11, color: '#7C7E9B', marginTop: 1 }}>{loc}</div>}
              </button>
            );
          })}

          {opts.length === 0 && !showAddRow && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: '#7C7E9B' }}>
              {suppliers.length === 0
                ? 'No suppliers in the directory yet'
                : `No suppliers match “${query}”`}
            </div>
          )}

          {showAddRow && (
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); handleAddNew(); }}
              disabled={addBusy}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '9px 12px', fontSize: 13, fontWeight: 600,
                color: '#C65A1A', background: 'transparent',
                border: 0, borderTop: '1px solid #EEF0F4', cursor: 'pointer',
              }}
            >
              {addBusy ? 'Adding…' : `+ Add new supplier “${query.trim()}”`}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default SupplierPicker;

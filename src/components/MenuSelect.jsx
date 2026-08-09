// Cargo's filter / sort control: a labelled button that opens a checked list.
//
// Lifted from the inline one in pages/supplier-portal/views/SupplierOrders.jsx,
// which is where this pattern already lives — same shape, same behaviour, same
// terracotta "this is not the default" treatment on the trigger. Colours come
// from the --d-* tokens so it sits on any .cargo-editorial surface.
//
// (SupplierOrders still has its own copy. It should fold into this one; it's
// left alone here because re-touching that page isn't what this change is for.)
import React, { useEffect, useRef, useState } from 'react';
import Icon from './AppIcon';
import './menu-select.css';

export default function MenuSelect({ label, icon, value, options = [], onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  // The first option is the resting state — anything else earns the accent, so
  // a glance at the toolbar says whether a list is filtered.
  const isDefault = !options.length || value === options[0].key;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const chosen = options.find((o) => o.key === value);

  return (
    <div className="ms" ref={ref}>
      <button type="button" className={`ms-btn${isDefault ? '' : ' on'}`}
        aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {icon && <Icon name={icon} size={13} />}
        {label}
        {!isDefault && <span className="ms-dot" />}
        <Icon name="ChevronDown" size={12} />
      </button>

      {open && (
        <div className="ms-pop" role="listbox" aria-label={label}>
          {options.map((o) => (
            <button key={o.key} type="button" role="option" aria-selected={o.key === value}
              className={`ms-opt${o.key === value ? ' on' : ''}`}
              disabled={o.disabled}
              onClick={() => { onChange?.(o.key); setOpen(false); }}>
              <span className="ms-tick">
                {o.key === value && <Icon name="Check" size={13} />}
              </span>
              <span className="ms-lab">{o.label}</span>
              {o.count != null && <span className="ms-count">{o.count}</span>}
            </button>
          ))}
        </div>
      )}
      {/* The chosen value is announced for screen readers; sighted users read it
          from the accent on the trigger plus the list itself. */}
      <span className="sr-only">{chosen ? `${label}: ${chosen.label}` : label}</span>
    </div>
  );
}

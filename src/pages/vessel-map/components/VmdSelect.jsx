// Editorial dropdown — replaces native <select> (which renders OS-styled option
// lists that clash with the Cargo look). Trigger + popover list, click-outside to
// close. Used for department / crew / also-notify on the defect form.
import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import './DefectPin.css';

export default function VmdSelect({ value, onChange, options = [], placeholder = 'Select…', disabled, ariaLabel, emptyText = 'No one available' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div className={`vmd-ddl${disabled ? ' disabled' : ''}`} ref={ref}>
      <button type="button" className="vmd-ddl-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open}
        disabled={disabled} onClick={() => setOpen((v) => !v)}>
        <span className={selected ? 'vmd-ddl-val' : 'vmd-ddl-ph'}>{selected ? selected.label : placeholder}</span>
        <Icon name="ChevronDown" size={16} className="vmd-ddl-chev" />
      </button>
      {open && (
        <div className="vmd-ddl-menu" role="listbox">
          {options.length === 0 ? (
            <div className="vmd-ddl-empty">{emptyText}</div>
          ) : options.map((o) => (
            <button type="button" key={o.value} role="option" aria-selected={o.value === value}
              className={`vmd-ddl-opt${o.value === value ? ' on' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false); }}>
              <span>{o.label}</span>
              {o.value === value && <Icon name="Check" size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

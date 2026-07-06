import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import './time-select.css';

// Cargo-styled time picker — reusable. 30-minute increments, 24-hour
// display (matches the rota grid's 24-hour cell labelling). Opens a
// scrollable styled menu below the trigger; supports click-outside,
// Escape to close, and scrolls the active option into view on open.
//
// Props:
//   value     — 'HH:MM' string ('06:00') or null
//   onChange  — (next 'HH:MM') => void
//   disabled  — bool
//   ariaLabel — string
//   className — extra class on the outer wrapper

function generateTimes() {
  const out = [];
  for (let h = 0; h < 24; h += 1) {
    out.push(`${String(h).padStart(2, '0')}:00`);
    out.push(`${String(h).padStart(2, '0')}:30`);
  }
  return out;
}

export default function TimeSelect({
  value, onChange, disabled = false, ariaLabel, className,
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const times = useMemo(generateTimes, []);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!menuRef.current?.contains(e.target)
          && !triggerRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const sel = menuRef.current?.querySelector('[aria-selected="true"]');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }, [open]);

  const display = value || '—';
  const wrapClass = [
    'time-select',
    disabled ? 'is-disabled' : '',
    open ? 'is-open' : '',
    className || '',
  ].filter(Boolean).join(' ');

  return (
    <div className={wrapClass}>
      <button
        ref={triggerRef}
        type="button"
        className="time-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="time-select-value">{display}</span>
        <ChevronDown size={12} className="time-select-chevron" />
      </button>
      {open && (
        <div ref={menuRef} className="time-select-menu" role="listbox">
          {times.map((t) => (
            <button
              key={t}
              type="button"
              role="option"
              aria-selected={t === value}
              className={`time-select-opt${t === value ? ' is-active' : ''}`}
              onClick={() => { onChange?.(t); setOpen(false); }}
            >{t}</button>
          ))}
        </div>
      )}
    </div>
  );
}

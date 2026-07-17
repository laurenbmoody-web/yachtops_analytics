import React, { useEffect, useRef, useState } from 'react';

import Icon from '../../../components/AppIcon';
import '../laundry.css';

// Shared dropdown behaviour for the Filters / Sort buttons: close on
// outside-click or Escape. Used by both the laundry dashboard and history.
export const useMenu = () => {
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
  return [open, setOpen, ref];
};

// One "Filters" button → popover of labelled <select> groups.
// groups: [{ key, label, value, onChange, neutral, options: [{ value, label }] }]
// The active badge counts any group whose value isn't its neutral (default).
export function FilterMenu({ groups }) {
  const [open, setOpen, ref] = useMenu();
  const active = (groups || []).reduce((n, g) => n + (g.value !== g.neutral ? 1 : 0), 0);
  return (
    <div className="lmf" ref={ref}>
      <button type="button" className={`lmf-btn${open ? ' open' : ''}${active ? ' on' : ''}`} onClick={() => setOpen((o) => !o)}>
        <Icon name="SlidersHorizontal" size={14} />
        <span>Filters</span>
        {active > 0 && <span className="lmf-badge">{active}</span>}
        <Icon name="ChevronDown" size={14} className="chev" />
      </button>
      {open && (
        <div className="lmf-pop">
          {(groups || []).map((g) => (
            <div className="lmf-group" key={g.key}>
              <span className="lmf-label">{g.label}</span>
              <div className="lmf-select">
                <select value={g.value} onChange={(e) => g.onChange(e.target.value)}>
                  {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// One "Sort" button → tick list. options: [{ val, label }]; the first is the
// default, so the button reads "active" for any other choice.
export function SortMenu({ value, onChange, options }) {
  const [open, setOpen, ref] = useMenu();
  const def = options?.[0]?.val;
  return (
    <div className="lmf" ref={ref}>
      <button type="button" className={`lmf-btn${open ? ' open' : ''}${value !== def ? ' on' : ''}`} onClick={() => setOpen((o) => !o)}>
        <Icon name="ArrowUpDown" size={14} />
        <span>Sort</span>
        <Icon name="ChevronDown" size={14} className="chev" />
      </button>
      {open && (
        <div className="lmf-pop lmf-sortpop">
          {(options || []).map((o) => (
            <button key={o.val} type="button" className={`lmf-sortopt${o.val === value ? ' sel' : ''}`} onClick={() => { onChange(o.val); setOpen(false); }}>
              <span>{o.label}</span>{o.val === value && <Icon name="Check" size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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

// One filter group — a Cargo field that expands its options inline (tick-list)
// straight from the box, rather than a native <select> dropdown.
function FilterField({ group }) {
  const [open, setOpen] = useState(false);
  const current = group.options.find((o) => o.value === group.value)?.label || 'Any';
  const changed = group.value !== group.neutral;
  return (
    <div className="lmf-group">
      <span className="lmf-label">{group.label}</span>
      <button type="button" className={`lmf-field${open ? ' open' : ''}${changed ? ' on' : ''}`} onClick={() => setOpen((o) => !o)}>
        <span className={`lmf-field-val${open ? ' ph' : ''}`}>{open ? 'Choose…' : current}</span>
        <Icon name="ChevronDown" size={14} className="chev" />
      </button>
      {open && (
        <div className="lmf-fieldopts">
          {group.options.map((o) => (
            <button key={o.value} type="button" className={`lmf-sortopt${o.value === group.value ? ' sel' : ''}`} onClick={() => { group.onChange(o.value); setOpen(false); }}>
              <span>{o.label}</span>{o.value === group.value && <Icon name="Check" size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// One "Filters" button → popover of labelled filter fields.
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
          {(groups || []).map((g) => <FilterField key={g.key} group={g} />)}
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

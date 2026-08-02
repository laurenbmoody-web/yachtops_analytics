// EditorialSelect — a dropdown in the Cargo editorial language.
//
// A native <select> hands its option list to the operating system, which draws it
// in the OS's own colours, at the OS's own size, floating over the field rather
// than hanging off it. On a page this deliberately styled that reads as a hole:
// blue highlight bars, system type, a panel that covers the label you were
// answering.
//
// This keeps the same contract as the element it replaces — a value, an onChange
// carrying that value, a disabled flag — so swapping one in is a markup change
// and nothing else. The list is anchored under the field, matches its width, and
// closes on outside click, Escape or a choice.
//
// (pages/vessel-map/components/VmdSelect predates this and does the same job for
// the defect form. It should fold into this one; it's left alone here because
// re-skinning that page isn't what this change is for.)
import React, { useEffect, useRef, useState } from 'react';
import Icon from '../AppIcon';
import './editorial-select.css';

export default function EditorialSelect({
  value, onChange, options = [], placeholder = 'Not set',
  disabled = false, ariaLabel, id, className = '',
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); wrap.current?.querySelector('button')?.focus(); } };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Open onto the chosen row rather than the top of the list — on a crew list of
  // twenty, the one you already picked shouldn't need finding again.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  const chosen = options.find((o) => String(o.value) === String(value));

  const pick = (v) => { onChange?.(v); setOpen(false); };

  const onTriggerKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div className={`es${disabled ? ' is-disabled' : ''} ${className}`.trim()} ref={wrap}>
      <button type="button" id={id} className={`es-trigger${open ? ' is-open' : ''}`}
        disabled={disabled} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((v) => !v)} onKeyDown={onTriggerKey}>
        <span className={chosen ? 'es-val' : 'es-val is-ph'}>{chosen ? chosen.label : placeholder}</span>
        <Icon name="ChevronDown" size={15} />
      </button>

      {open && (
        <div className="es-list" role="listbox" ref={listRef} aria-label={ariaLabel}>
          {options.map((o, i) => {
            const on = String(o.value) === String(value);
            // Options may carry a `group`; a header is drawn wherever it changes,
            // which is what <optgroup> did for the chart of accounts.
            const head = o.group && o.group !== options[i - 1]?.group
              ? <p className="es-group" key={`g-${o.group}`}>{o.group}</p>
              : null;
            return (
              <React.Fragment key={String(o.value)}>
                {head}
                <button type="button" role="option" aria-selected={on}
                  className={`es-opt${on ? ' on' : ''}`} onClick={() => pick(o.value)}>
                  <span>{o.label}</span>
                  {on && <Icon name="Check" size={14} />}
                </button>
              </React.Fragment>
            );
          })}
          {!options.length && <p className="es-empty">Nothing to choose from</p>}
        </div>
      )}
    </div>
  );
}

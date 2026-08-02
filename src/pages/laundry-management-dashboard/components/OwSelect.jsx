import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';

// Cargo-styled select — the box IS the field; its options expand connected
// directly beneath it (no native OS dropdown). Accepts string[] or
// {value,label}[]; include a '—' option if the field is clearable.
const OwSelect = ({ value, onChange, options = [], placeholder = '—' }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const current = opts.find((o) => String(o.value) === String(value));

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className={`ow-fld${open ? ' open' : ''}`} ref={ref}>
      <button type="button" className="ow-fldbox" onClick={() => setOpen((o) => !o)}>
        <span className={`ow-fldval${current ? '' : ' ph'}`}>{current ? current.label : placeholder}</span>
        <Icon name="ChevronDown" size={16} className="ow-fldchev" />
      </button>
      {open && (
        <div className="ow-fldopts">
          {opts.map((o) => (
            <button type="button" key={String(o.value)} className={`ow-fldopt${String(o.value) === String(value) ? ' sel' : ''}`} onClick={() => { onChange(o.value); setOpen(false); }}>
              <span>{o.label}</span>{String(o.value) === String(value) && <Icon name="Check" size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default OwSelect;

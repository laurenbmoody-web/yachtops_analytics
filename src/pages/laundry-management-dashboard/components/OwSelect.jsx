import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../components/AppIcon';

// Cargo-styled select — the box IS the field, showing the current value; its
// options open in a panel connected directly beneath, overlaying the fields
// below (portaled so the scrollable modal never clips it). The current value is
// NOT repeated in the list. Accepts string[] or {value,label}[]; include a '—'
// option to allow clearing.
const OwSelect = ({ value, onChange, options = [], placeholder = '—' }) => {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const boxRef = useRef(null);
  const panelRef = useRef(null);
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const current = opts.find((o) => String(o.value) === String(value));
  // The box already shows the current choice — the list is the OTHER options.
  const others = opts.filter((o) => String(o.value) !== String(value));

  const place = useCallback(() => {
    const el = boxRef.current;
    if (el) { const r = el.getBoundingClientRect(); setRect({ top: r.bottom, left: r.left, width: r.width }); }
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (boxRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onMove = () => place();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, place]);

  return (
    <div className={`ow-fld${open ? ' open' : ''}`}>
      <button ref={boxRef} type="button" className="ow-fldbox" onClick={() => setOpen((o) => !o)}>
        <span className={`ow-fldval${current ? '' : ' ph'}`}>{current ? current.label : placeholder}</span>
        <Icon name="ChevronDown" size={16} className="ow-fldchev" />
      </button>
      {open && rect && createPortal(
        <div ref={panelRef} className="ow-fldopts" style={{ top: rect.top, left: rect.left, width: rect.width }}>
          {others.map((o) => (
            <button type="button" key={String(o.value)} className="ow-fldopt" onClick={() => { onChange(o.value); setOpen(false); }}>
              <span>{o.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
};

export default OwSelect;

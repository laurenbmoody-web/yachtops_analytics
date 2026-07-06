import React, {
  useEffect, useLayoutEffect, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import './time-wheel.css';

// Single-time picker with an iPhone-alarm scroll wheel — the same wheel used
// when logging Hours of Rest (HORHybridLog). The trigger renders inline (style
// it via `className`); tapping it drops a compact wheel popover anchored just
// below the trigger. Values snap to the 30-minute grid and commit on Done (or
// clicking outside). Portaled so it escapes any overflow clipping, positioned
// against the trigger's rect.
//
// Props:
//   value     — 'HH:MM' string ('22:00') or null
//   onChange  — (next 'HH:MM') => void
//   disabled  — bool
//   ariaLabel — string
//   className — extra class(es) on the trigger button

const WHEEL_ITEM_H = 32;
const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: String(h).padStart(2, '0') }));
const MINUTES = [{ value: 0, label: '00' }, { value: 30, label: '30' }];
const pad = (n) => String(n).padStart(2, '0');

const Wheel = ({ items, value, onChange }) => {
  const ref = useRef(null);
  const settle = useRef(null);
  useEffect(() => {
    const idx = items.findIndex((it) => it.value === value);
    if (ref.current && idx >= 0 && Math.round(ref.current.scrollTop / WHEEL_ITEM_H) !== idx) {
      ref.current.scrollTop = idx * WHEEL_ITEM_H;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const onScroll = () => {
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      if (!ref.current) return;
      const idx = Math.max(0, Math.min(items.length - 1, Math.round(ref.current.scrollTop / WHEEL_ITEM_H)));
      ref.current.scrollTo({ top: idx * WHEEL_ITEM_H, behavior: 'smooth' });
      if (items[idx].value !== value) onChange(items[idx].value);
    }, 90);
  };
  useEffect(() => () => { if (settle.current) clearTimeout(settle.current); }, []);
  return (
    <div className="cp-wheel-frame">
      <div className="cp-wheel" ref={ref} onScroll={onScroll}>
        <div className="cp-wheel-pad" />
        {items.map((it) => (
          <button
            key={it.value}
            type="button"
            className={`cp-wheel-it${it.value === value ? ' sel' : ''}`}
            onClick={() => onChange(it.value)}
          >
            {it.label}
          </button>
        ))}
        <div className="cp-wheel-pad" />
      </div>
      <div className="cp-wheel-band" aria-hidden="true" />
    </div>
  );
};

export default function TimeWheel({
  value, onChange, disabled = false, ariaLabel, className,
}) {
  const [open, setOpen] = useState(false);
  const [h, setH] = useState(0);
  const [m, setM] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const popRef = useRef(null);

  const parse = () => {
    const [ph, pm] = (value || '00:00').split(':').map((n) => parseInt(n, 10));
    return [Number.isFinite(ph) ? ph : 0, pm === 30 ? 30 : 0];
  };

  const place = () => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const popW = popRef.current?.offsetWidth || 188;
    const popH = popRef.current?.offsetHeight || 268;
    let left = r.left;
    left = Math.min(left, window.innerWidth - popW - 8);
    left = Math.max(8, left);
    // Drop below the pill; flip above if it would run off the bottom.
    let top = r.bottom + 6;
    if (top + popH > window.innerHeight - 8) top = Math.max(8, r.top - popH - 6);
    setPos({ top, left });
  };

  const openSheet = () => {
    if (disabled) return;
    const [ph, pm] = parse();
    setH(ph); setM(pm); setOpen(true);
  };

  useLayoutEffect(() => {
    if (open) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e) => {
      if (!popRef.current?.contains(e.target) && !triggerRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    const onReflow = () => place();
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const commit = () => { onChange?.(`${pad(h)}:${pad(m)}`); setOpen(false); };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openSheet())}
      >
        {value || '—'}
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          className="tw-pop"
          role="dialog"
          aria-label={ariaLabel}
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="tw-wheels">
            <Wheel items={HOURS} value={h} onChange={setH} />
            <span className="tw-colon">:</span>
            <Wheel items={MINUTES} value={m} onChange={setM} />
          </div>
          <div className="tw-actions">
            <button type="button" className="tw-cancel" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="tw-done" onClick={commit}>Done</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

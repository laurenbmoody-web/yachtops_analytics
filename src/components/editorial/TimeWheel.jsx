import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './time-wheel.css';

// Single-time picker with an iPhone-alarm scroll wheel — the same wheel used
// when logging Hours of Rest (HORHybridLog). The trigger renders inline (style
// it via `className`); tapping it opens a centred, dimmed wheel sheet. Values
// snap to the 30-minute grid.
//
// Props:
//   value     — 'HH:MM' string ('22:00') or null
//   onChange  — (next 'HH:MM') => void   (fired on Done)
//   disabled  — bool
//   ariaLabel — string
//   className — extra class(es) on the trigger button
//   title     — heading shown above the wheels

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
  value, onChange, disabled = false, ariaLabel, className, title = 'Set time',
}) {
  const [open, setOpen] = useState(false);
  const [h, setH] = useState(0);
  const [m, setM] = useState(0);

  const parse = () => {
    const [ph, pm] = (value || '00:00').split(':').map((n) => parseInt(n, 10));
    return [Number.isFinite(ph) ? ph : 0, pm === 30 ? 30 : 0];
  };

  const openSheet = () => {
    if (disabled) return;
    const [ph, pm] = parse();
    setH(ph); setM(pm); setOpen(true);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const commit = () => { onChange?.(`${pad(h)}:${pad(m)}`); setOpen(false); };

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        onClick={openSheet}
      >
        {value || '—'}
      </button>
      {open && createPortal(
        <div
          className="tw-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel || title}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="tw-modal">
            <h3 className="tw-title">{title}</h3>
            <div className="tw-wheels">
              <Wheel items={HOURS} value={h} onChange={setH} />
              <span className="tw-colon">:</span>
              <Wheel items={MINUTES} value={m} onChange={setM} />
            </div>
            <div className="tw-actions">
              <button type="button" className="tw-cancel" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="tw-done" onClick={commit}>Done</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

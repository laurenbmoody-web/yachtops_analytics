// EditorialTimePicker — a 24-hour "scroll clock": click the field and pick the
// hour and minute from two scrollable columns (no typing). Value shape is
// 'HH:MM' (24h) or '' (empty), matching a plain time input.
//
// Portals its popover to <body> and positions it fixed, so an overflow:hidden
// modal panel can't clip it (same approach as EditorialDatePicker).

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import useDismissable from '../ui/useDismissable';
import './editorial-time-picker.css';

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0')); // 5-min steps

const ClockIcon = (props) => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="8" cy="8" r="6.25" /><path d="M8 4.5V8l2.4 1.6" />
  </svg>
);

const parse = (v) => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(v || ''));
  return m ? { h: m[1], m: m[2] } : { h: '', m: '' };
};

const EditorialTimePicker = ({ value = '', onChange, placeholder = 'HH:MM', ariaLabel, disabled = false }) => {
  const { h, m } = parse(value);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);

  const wrapRef = useRef(null);
  const popRef = useRef(null);
  const hourColRef = useRef(null);
  const minColRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);
  useDismissable({ onClose: close, enabled: open });

  const computePosition = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 6;
    const popH = popRef.current?.offsetHeight || 232;
    const below = window.innerHeight - r.bottom;
    const above = below < popH + gap && r.top > popH + gap;
    setCoords({ top: above ? Math.max(8, r.top - gap - popH) : r.bottom + gap, left: r.left });
  }, []);

  useLayoutEffect(() => {
    if (!open) { setCoords(null); return undefined; }
    computePosition();
    const onReflow = () => computePosition();
    window.addEventListener('scroll', onReflow, true);
    window.addEventListener('resize', onReflow);
    return () => {
      window.removeEventListener('scroll', onReflow, true);
      window.removeEventListener('resize', onReflow);
    };
  }, [open, computePosition]);

  // Centre the current hour/minute in view when the popover opens.
  useEffect(() => {
    if (!open) return;
    const scrollTo = (col, val) => {
      const btn = col?.querySelector(`[data-v="${val}"]`);
      if (btn) col.scrollTop = btn.offsetTop - col.clientHeight / 2 + btn.clientHeight / 2;
    };
    requestAnimationFrame(() => { scrollTo(hourColRef.current, h || '08'); scrollTo(minColRef.current, m || '00'); });
  }, [open, h, m]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, close]);

  const emit = (nh, nm) => onChange?.(`${nh}:${nm}`);
  const pickHour = (nh) => emit(nh, m || '00');
  const pickMin = (nm) => emit(h || '00', nm);

  return (
    <div className="etp" ref={wrapRef}>
      <button
        type="button"
        className={`etp-field${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel || placeholder}
      >
        <span className={`etp-value${value ? '' : ' is-placeholder'}`}>{value || placeholder}</span>
        <span className="etp-icon"><ClockIcon /></span>
      </button>

      {open && createPortal(
        <div
          className="etp-pop"
          ref={popRef}
          role="dialog"
          aria-label={ariaLabel ? `${ariaLabel} time` : 'Pick a time'}
          style={coords ? { top: coords.top, left: coords.left } : { visibility: 'hidden' }}
        >
          <div className="etp-cols">
            <div className="etp-col" ref={hourColRef} aria-label="Hour">
              {HOURS.map((hh) => (
                <button key={hh} type="button" data-v={hh}
                  className={`etp-opt${hh === h ? ' is-sel' : ''}`} onClick={() => pickHour(hh)}>{hh}</button>
              ))}
            </div>
            <span className="etp-colon">:</span>
            <div className="etp-col" ref={minColRef} aria-label="Minute">
              {MINUTES.map((mm) => (
                <button key={mm} type="button" data-v={mm}
                  className={`etp-opt${mm === m ? ' is-sel' : ''}`} onClick={() => pickMin(mm)}>{mm}</button>
              ))}
            </div>
          </div>
          <div className="etp-foot">
            <button type="button" className="etp-foot-btn" onClick={() => { onChange?.(''); close(); }}>Clear</button>
            <button type="button" className="etp-foot-btn is-done" onClick={close}>Done</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default EditorialTimePicker;

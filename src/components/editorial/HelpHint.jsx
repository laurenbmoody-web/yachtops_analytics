import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../AppIcon';
import './help-hint.css';

// Small (?) icon that opens an editorial popover with example content.
// Used next to ambiguous column headers / labels to teach by example
// without splitting the column or cluttering the placeholder.
//
// The popover is PORTALED to <body> and positioned with fixed
// coordinates read from the trigger, so it can never be clipped by an
// ancestor's overflow (e.g. the board's horizontally-scrolling table).
// It prefers to open below the trigger and auto-flips above when it
// would overrun the viewport bottom.
//
// Props:
//   title    — optional bold headline at the top of the popover
//   children — popover body (any JSX). For the standard bucket-list
//              pattern, pass <HelpHintBuckets buckets={[...]} />
//   align    — 'start' (popover's leading edge aligns to the trigger)
//              or 'end' (trailing edge aligns) — a hint for horizontal
//              placement; the popover is still clamped into the viewport.
//   width    — popover width in px (default 280)
//   ariaLabel — accessible name for the trigger button
//
// Behaviour:
//   - Hover or focus to open. Tap on touch.
//   - Closes on outside click, Escape, or focus-out.
//   - Repositions on scroll / resize while open.
const HelpHint = ({ title, children, align = 'start', width = 280, ariaLabel = 'Show help' }) => {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const triggerRef = useRef(null);
  const popRef = useRef(null);

  const place = useCallback(() => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const gap = 6;
    const margin = 8;
    const popH = popRef.current ? popRef.current.offsetHeight : 0;

    // Horizontal — anchor by align, then clamp into the viewport.
    let left = align === 'end' ? r.right - width : r.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

    // Vertical — prefer below the trigger; flip above if it would
    // overrun the viewport bottom and there's more room up top.
    let top = r.bottom + gap;
    if (popH && top + popH > window.innerHeight - margin) {
      const above = r.top - gap - popH;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - popH - margin);
    }
    setCoords({ top, left });
  }, [align, width]);

  // Measure after the popover mounts, then pin it.
  useLayoutEffect(() => {
    if (open) place();
    else setCoords(null);
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onReflow = () => place();
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onReflow, true);
    window.addEventListener('resize', onReflow);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onReflow, true);
      window.removeEventListener('resize', onReflow);
    };
  }, [open, place]);

  return (
    <span
      className="help-hint"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={triggerRef}
        type="button"
        className="help-hint-trigger"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <Icon name="HelpCircle" style={{ width: 12, height: 12 }} aria-hidden="true" />
      </button>
      {open && createPortal(
        <span
          ref={popRef}
          className="help-hint-popover help-hint-popover-fixed"
          role="tooltip"
          style={{
            width,
            top: coords ? coords.top : -9999,
            left: coords ? coords.left : -9999,
            visibility: coords ? 'visible' : 'hidden',
          }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onClick={(e) => e.stopPropagation()}
        >
          {title && <span className="help-hint-title">{title}</span>}
          <span className="help-hint-body">{children}</span>
        </span>,
        document.body,
      )}
    </span>
  );
};

// Bucket list — common pattern for "what goes in this field?". Each
// bucket is a labelled prefix with an italic example value. Pass a `dot`
// colour on a bucket to render a colour swatch before its label — used
// for legends (e.g. the status-colour key).
export const HelpHintBuckets = ({ buckets }) => (
  <ul className="help-hint-buckets">
    {buckets.map((b, i) => (
      <li key={i}>
        <span className="help-hint-bucket-label">
          {b.dot && (
            <span
              className="help-hint-bucket-dot"
              style={{ background: b.dot }}
              aria-hidden="true"
            />
          )}
          {b.label}
        </span>
        <span className="help-hint-bucket-example">{b.example}</span>
      </li>
    ))}
  </ul>
);

export default HelpHint;

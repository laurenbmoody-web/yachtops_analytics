import React, { useEffect, useRef, useState } from 'react';
import Icon from '../AppIcon';
import './help-hint.css';

// Small (?) icon that opens an editorial popover with example content.
// Used next to ambiguous column headers / labels to teach by example
// without splitting the column or cluttering the placeholder.
//
// Props:
//   title    — optional bold headline at the top of the popover
//   children — popover body (any JSX). For the standard bucket-list
//              pattern, pass <HelpHintBuckets buckets={[...]} />
//   side     — 'top' | 'bottom' | 'left' | 'right' (default 'bottom')
//   width    — popover width in px (default 280)
//   ariaLabel — accessible name for the trigger button
//
// Behaviour:
//   - Hover or focus to open. Tap on touch.
//   - Closes on outside click, Escape, or focus-out.
//   - Trigger is keyboard-reachable; popover is role=tooltip.
const HelpHint = ({ title, children, side = 'bottom', width = 280, ariaLabel = 'Show help' }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span
      ref={wrapRef}
      className={`help-hint help-hint-${side}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
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
      {open && (
        <span
          className="help-hint-popover"
          role="tooltip"
          style={{ width }}
          onClick={(e) => e.stopPropagation()}
        >
          {title && <span className="help-hint-title">{title}</span>}
          <span className="help-hint-body">{children}</span>
        </span>
      )}
    </span>
  );
};

// Bucket list — common pattern for "what goes in this field?". Each
// bucket is a labelled prefix with an italic example value.
export const HelpHintBuckets = ({ buckets }) => (
  <ul className="help-hint-buckets">
    {buckets.map((b, i) => (
      <li key={i}>
        <span className="help-hint-bucket-label">{b.label}</span>
        <span className="help-hint-bucket-example">{b.example}</span>
      </li>
    ))}
  </ul>
);

export default HelpHint;

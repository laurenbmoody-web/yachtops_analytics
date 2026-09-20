import React, { useState, useEffect, useRef, useMemo } from 'react';
import { isoToUK, ukToISO, weekStartsOn, weekdayLabelsShort } from '../../utils/dateFormat';
import './date-input.css';

/**
 * European date field. Displays/accepts dd/mm/yyyy regardless of browser
 * locale (native <input type="date"> can't be forced to a format), while
 * keeping the value/onChange contract in ISO (yyyy-mm-dd):
 *
 *   <DateInput value={iso} onChange={(e) => set(e.target.value)} />
 *
 * The calendar button opens OUR calendar, not the browser's. showPicker()
 * used to draw Safari's: square corners, system-blue selection, system font,
 * and a different look again in every browser. Typing dd/mm/yyyy still works
 * and is usually faster.
 */

const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sameDay = (a, b) => a && b && toISO(a) === toISO(b);

/** The 42 cells of a month grid, starting on the user's first day of the week. */
const monthGrid = (year, month, firstDay) => {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() - firstDay + 7) % 7;
  const start = new Date(year, month, 1 - lead);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
};

const DateInput = React.forwardRef(({
  value = '', onChange, disabled = false, className, id, placeholder = 'dd/mm/yyyy', ...props
}, ref) => {
  const [text, setText] = useState(isoToUK(value));
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const wrapRef = useRef(null);

  const selected = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }, [value]);

  // The month on show. Follows the value, but only while the panel is shut —
  // paging to March and having it snap back on every keystroke is maddening.
  const [view, setView] = useState(() => selected || new Date());
  useEffect(() => { if (!open && selected) setView(selected); }, [open, selected]);

  useEffect(() => { setText(isoToUK(value)); }, [value]);

  const emit = (iso) => onChange?.({ target: { value: iso } });

  const handleText = (e) => {
    const t = e.target.value.replace(/[^\d/]/g, '');
    setText(t);
    if (t === '') { emit(''); return; }
    const iso = ukToISO(t);
    if (iso) emit(iso);
  };

  // Re-normalise the visible text to the canonical value on blur.
  const handleBlur = () => setText(isoToUK(value));

  // Close on click-outside and on Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Low in a drawer there is no room below, so the panel flips above.
  const toggle = () => {
    if (!open && wrapRef.current) {
      const box = wrapRef.current.getBoundingClientRect();
      setFlip(window.innerHeight - box.bottom < 330);
    }
    setOpen(!open);
  };

  const firstDay = weekStartsOn();
  const dows = weekdayLabelsShort();
  const today = new Date();
  const days = monthGrid(view.getFullYear(), view.getMonth(), firstDay);
  const monthLabel = view.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const pick = (d) => { emit(toISO(d)); setOpen(false); };
  const step = (n) => setView(new Date(view.getFullYear(), view.getMonth() + n, 1));

  return (
    <span className="di-wrap" ref={wrapRef}>
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        placeholder={placeholder}
        value={text}
        onChange={handleText}
        onBlur={handleBlur}
        disabled={disabled}
        id={id}
        className={className}
        style={{ width: '100%' }}
        {...props}
      />
      {!disabled && (
        <button
          type="button"
          className="di-trigger"
          onClick={toggle}
          aria-label="Open calendar"
          aria-expanded={open}
          tabIndex={-1}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </button>
      )}

      {open && !disabled && (
        <div className={`di-pop${flip ? ' up' : ''}`} role="dialog" aria-label="Choose a date">
          <div className="di-head">
            <button type="button" className="di-nav" onClick={() => step(-1)} aria-label="Previous month">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
            </button>
            <span className="di-month">{monthLabel}</span>
            <button type="button" className="di-nav" onClick={() => step(1)} aria-label="Next month">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          </div>

          <div className="di-grid">
            {dows.map((d) => <span key={d} className="di-dow">{d.slice(0, 2)}</span>)}
            {days.map((d) => {
              const out = d.getMonth() !== view.getMonth();
              const on = sameDay(d, selected);
              return (
                <button
                  key={toISO(d)}
                  type="button"
                  className={`di-day${out ? ' out' : ''}${sameDay(d, today) ? ' today' : ''}${on ? ' on' : ''}`}
                  onClick={() => pick(d)}
                  aria-pressed={on}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          <div className="di-foot">
            <button type="button" className="di-act" onClick={() => pick(new Date())}>Today</button>
            <button type="button" className="di-act muted" onClick={() => { emit(''); setOpen(false); }}>Clear</button>
          </div>
        </div>
      )}
    </span>
  );
});

DateInput.displayName = 'DateInput';
export default DateInput;

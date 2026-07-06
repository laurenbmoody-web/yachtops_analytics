// EditorialDatePicker — date input + calendar popover in the Cargo
// editorial design language.
//
// Drop-in replacement for native <input type="date"> where the value
// shape stays the same: '' (empty) or 'YYYY-MM-DD' (ISO date). The
// existing filter/derivation code that reads dateFrom / dateTo as a
// sortable string continues to work without modification.
//
// Display:
//   - Field shows the date formatted as DISPLAY_FORMAT (default
//     'dd/MM/yyyy', South Africa convention).
//   - Field is typeable; parse-on-blur. Invalid/half-typed input
//     reverts to the last valid value — never emits a broken value
//     to the consumer.
//   - Click the field (or the calendar icon) to open the popover.
//
// Popover:
//   - Cream card, navy text, rust accent for selected/today.
//   - Month nav (‹ ›), weekday strip, 6×7 day grid.
//   - Outside-month days are dimmed and clickable (scrolls month).
//   - Footer: Today + Clear ghost buttons.
//   - Closes on outside click, Esc, day selection, Today, Clear.
//
// Keyboard inside popover:
//   - Arrow keys move focus (±1 day, ±7 day).
//   - Enter selects the focused day.
//   - Esc closes (via useDismissable).
//
// Future user-preference for display format: pass `displayFormat` as
// a prop and it overrides the DISPLAY_FORMAT constant. One-line
// wiring when the settings surface lands.

import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  format, parse, isValid,
  startOfMonth, endOfMonth, addMonths, subMonths,
  startOfWeek, endOfWeek, eachDayOfInterval,
  isSameDay, isSameMonth, isToday,
  addDays,
} from 'date-fns';
import useDismissable from '../ui/useDismissable';
import './editorial-date-picker.css';

const DISPLAY_FORMAT = 'dd/MM/yyyy';
const ISO_FORMAT     = 'yyyy-MM-dd';
const WEEK_STARTS_ON = 1;  // Monday — matches UK/SA convention

// Defensive parse of an ISO 'YYYY-MM-DD' value back to a Date.
// Returns null on empty/invalid so callers can treat absence uniformly.
const parseIso = (iso) => {
  if (!iso) return null;
  const d = parse(iso, ISO_FORMAT, new Date());
  return isValid(d) ? d : null;
};

const formatDisplay = (date, displayFormat) => {
  if (!date || !isValid(date)) return '';
  return format(date, displayFormat);
};

const formatIso = (date) => {
  if (!date || !isValid(date)) return '';
  return format(date, ISO_FORMAT);
};

const ChevronLeft = (props) => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M10 12L6 8l4-4" />
  </svg>
);
const ChevronRight = (props) => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M6 4l4 4-4 4" />
  </svg>
);
const CalendarIcon = (props) => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="2" y="3" width="12" height="11" rx="1.5" />
    <path d="M2 6h12M5 2v2M11 2v2" />
  </svg>
);

const EditorialDatePicker = ({
  value = '',
  onChange,
  placeholder = 'Pick a date',
  ariaLabel,
  disabled = false,
  displayFormat = DISPLAY_FORMAT,
  // Optional: the OTHER end of a date range (ISO). When set, the calendar tints
  // the days between it and the selected/hovered day (rust range fill), so the
  // continuation from the start date is visible. Off by default — no rangeStart,
  // no change to behaviour.
  rangeStart = '',
  // Optional: already-spoken-for date spans to flag with a quiet dot under the
  // day (e.g. periods already logged elsewhere). Each item is { from, to } ISO;
  // a null/'' `to` marks open-ended (from → onward). Empty by default.
  markedRanges = [],
}) => {
  const valueDate = useMemo(() => parseIso(value), [value]);
  const rangeAnchor = useMemo(() => parseIso(rangeStart), [rangeStart]);
  const [hoverDate, setHoverDate] = useState(null);
  const marked = useMemo(
    () => (markedRanges || [])
      .map(r => ({ from: parseIso(r.from), to: parseIso(r.to) }))
      .filter(r => r.from),
    [JSON.stringify(markedRanges)], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const [open, setOpen]                 = useState(false);
  const [text, setText]                 = useState(formatDisplay(valueDate, displayFormat));
  const [viewMonth, setViewMonth]       = useState(() => valueDate || new Date());
  const [focusedDate, setFocusedDate]   = useState(() => valueDate || new Date());

  const wrapperRef = useRef(null);
  const popoverRef = useRef(null);
  const inputRef   = useRef(null);
  const focusedBtnRef = useRef(null);
  // Popover is portaled to <body> and positioned fixed so it escapes any
  // overflow:hidden / scroll container (e.g. a modal panel) that would
  // otherwise clip it. null until first measured.
  const [coords, setCoords] = useState(null);
  // After a selection we refocus the input for keyboard users; that focus must
  // NOT reopen the popover (onFocus opens it). One-shot guard.
  const skipReopenRef = useRef(false);

  // Sync display text when value changes from outside.
  useEffect(() => {
    setText(formatDisplay(valueDate, displayFormat));
  }, [valueDate, displayFormat]);

  // When popover opens, seed view and focus from current value (or today).
  const openPopover = useCallback(() => {
    if (disabled) return;
    const seed = valueDate || new Date();
    setViewMonth(seed);
    setFocusedDate(seed);
    setOpen(true);
  }, [disabled, valueDate]);

  const closePopover = useCallback(() => { setOpen(false); setHoverDate(null); }, []);

  // Fixed-position the portaled popover under (or above, if short on space)
  // the field. Recomputed on open, and on scroll/resize while open.
  const computePosition = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 6;
    const popH = popoverRef.current?.offsetHeight || 360;
    const spaceBelow = window.innerHeight - rect.bottom;
    const placeAbove = spaceBelow < popH + gap && rect.top > popH + gap;
    setCoords({
      top: placeAbove ? Math.max(8, rect.top - gap - popH) : rect.bottom + gap,
      left: rect.left,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) { setCoords(null); return undefined; }
    computePosition();
    const onReflow = () => computePosition();
    window.addEventListener('scroll', onReflow, true);  // capture: catch ancestor scroll
    window.addEventListener('resize', onReflow);
    return () => {
      window.removeEventListener('scroll', onReflow, true);
      window.removeEventListener('resize', onReflow);
    };
  }, [open, computePosition]);

  // Esc-to-close (via the shared hook).
  useDismissable({ onClose: closePopover, enabled: open });

  // Outside-click close. mousedown so the field's own click doesn't race.
  // The popover is portaled outside wrapperRef, so check it explicitly too.
  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (e) => {
      if (wrapperRef.current?.contains(e.target)) return;
      if (popoverRef.current?.contains(e.target)) return;
      closePopover();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open, closePopover]);

  // Move browser focus to the focused day button when it changes (after open).
  useEffect(() => {
    if (open && focusedBtnRef.current) focusedBtnRef.current.focus();
  }, [open, focusedDate]);

  // Emit a new value. Empty string clears the filter; ISO string sets it.
  const emit = useCallback((nextDate) => {
    if (!nextDate) {
      onChange?.('');
      return;
    }
    const iso = formatIso(nextDate);
    if (iso) onChange?.(iso);
  }, [onChange]);

  // Field handlers ─────────────────────────────────────────────────────────
  const handleInputFocus = () => {
    if (disabled) return;
    if (skipReopenRef.current) { skipReopenRef.current = false; return; }
    openPopover();
  };
  const handleInputChange = (e) => setText(e.target.value);
  const handleInputBlur = (e) => {
    // If focus moved into the popover, don't blur-process — the popover
    // owns the next interaction. Defer parsing until the field truly
    // loses focus.
    if (wrapperRef.current?.contains(e.relatedTarget)) return;
    if (popoverRef.current?.contains(e.relatedTarget)) return;
    const raw = text.trim();
    if (raw === '') {
      emit('');
      return;
    }
    const parsed = parse(raw, displayFormat, new Date());
    if (isValid(parsed)) {
      emit(parsed);
      setText(formatDisplay(parsed, displayFormat));   // canonicalise
    } else {
      // Bad parse — revert text to the last valid value's formatted form.
      // Never emit a broken value.
      setText(formatDisplay(valueDate, displayFormat));
    }
  };
  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleInputBlur({ relatedTarget: null });
      inputRef.current?.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      openPopover();
    }
  };

  // Popover handlers ───────────────────────────────────────────────────────
  const selectDate = (date) => {
    emit(date);
    setText(formatDisplay(date, displayFormat));
    closePopover();
    // Return focus to the input after selection — without reopening the popover.
    skipReopenRef.current = true;
    setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0);
  };
  const handleToday = () => selectDate(new Date());
  const handleClear = () => {
    emit('');
    setText('');
    closePopover();
    skipReopenRef.current = true;
    setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0);
  };

  const moveFocus = (delta) => {
    const next = addDays(focusedDate, delta);
    setFocusedDate(next);
    if (!isSameMonth(next, viewMonth)) setViewMonth(next);
  };

  const handleGridKeyDown = (e) => {
    switch (e.key) {
      case 'ArrowLeft':  e.preventDefault(); moveFocus(-1);  break;
      case 'ArrowRight': e.preventDefault(); moveFocus(1);   break;
      case 'ArrowUp':    e.preventDefault(); moveFocus(-7);  break;
      case 'ArrowDown':  e.preventDefault(); moveFocus(7);   break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        selectDate(focusedDate);
        break;
      default: break;
    }
  };

  // Grid data ──────────────────────────────────────────────────────────────
  const gridDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: WEEK_STARTS_ON });
    const end   = endOfWeek(endOfMonth(viewMonth),     { weekStartsOn: WEEK_STARTS_ON });
    return eachDayOfInterval({ start, end });
  }, [viewMonth]);

  const weekdayLabels = useMemo(() => {
    // 'EEEEE' is the single-character weekday in date-fns ('M', 'T', ...).
    const ref = startOfWeek(new Date(), { weekStartsOn: WEEK_STARTS_ON });
    return Array.from({ length: 7 }, (_, i) => format(addDays(ref, i), 'EEEEE'));
  }, []);

  return (
    <div className="edp" ref={wrapperRef}>
      <div className={`edp-field${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          className="edp-input"
          placeholder={placeholder}
          aria-label={ariaLabel || placeholder}
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled}
          value={text}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          onKeyDown={handleInputKeyDown}
        />
        <button
          type="button"
          className="edp-trigger"
          onClick={openPopover}
          disabled={disabled}
          aria-label="Open calendar"
          tabIndex={-1}
        >
          <CalendarIcon />
        </button>
      </div>

      {open && createPortal(
        <div
          className="edp-popover edp-popover--fixed"
          ref={popoverRef}
          role="dialog"
          aria-modal="false"
          aria-label={ariaLabel ? `${ariaLabel} calendar` : 'Calendar'}
          style={coords
            ? { top: coords.top, left: coords.left }
            : { visibility: 'hidden' }}
        >
          <div className="edp-pop-head">
            <button
              type="button"
              className="edp-nav-btn"
              onClick={() => setViewMonth(subMonths(viewMonth, 1))}
              aria-label="Previous month"
            >
              <ChevronLeft />
            </button>
            <div className="edp-month-label" aria-live="polite">
              {format(viewMonth, 'MMMM yyyy')}
            </div>
            <button
              type="button"
              className="edp-nav-btn"
              onClick={() => setViewMonth(addMonths(viewMonth, 1))}
              aria-label="Next month"
            >
              <ChevronRight />
            </button>
          </div>

          <div className="edp-weekdays" role="row">
            {weekdayLabels.map((wd, i) => (
              <div key={i} className="edp-weekday" role="columnheader">{wd}</div>
            ))}
          </div>

          <div
            className="edp-grid"
            role="grid"
            onKeyDown={handleGridKeyDown}
            onMouseLeave={() => { if (rangeAnchor) setHoverDate(null); }}
          >
            {gridDays.map((d) => {
              const inMonth     = isSameMonth(d, viewMonth);
              const isSelected  = valueDate && isSameDay(d, valueDate);
              const isFocused   = isSameDay(d, focusedDate);
              const isTodayCell = isToday(d);
              // Range fill: days strictly between the anchor (the other end) and
              // the moving end (hovered day while open, else the selected value).
              let inRange = false, isAnchor = false;
              if (rangeAnchor) {
                isAnchor = isSameDay(d, rangeAnchor);
                const other = hoverDate || valueDate;
                if (other) {
                  const lo = rangeAnchor <= other ? rangeAnchor : other;
                  const hi = rangeAnchor <= other ? other : rangeAnchor;
                  inRange = d > lo && d < hi;
                }
              }
              const isMarked = marked.some(r => d >= r.from && (!r.to || d <= r.to));
              const cls = [
                'edp-day',
                inMonth     ? '' : 'is-outside',
                inRange     ? 'is-in-range' : '',
                isAnchor && !isSelected ? 'is-range-anchor' : '',
                isSelected  ? 'is-selected' : '',
                isTodayCell ? 'is-today'    : '',
                isMarked    ? 'is-marked'   : '',
              ].filter(Boolean).join(' ');
              return (
                <button
                  key={d.toISOString()}
                  ref={isFocused ? focusedBtnRef : null}
                  type="button"
                  role="gridcell"
                  className={cls}
                  aria-selected={isSelected || false}
                  aria-current={isTodayCell ? 'date' : undefined}
                  tabIndex={isFocused ? 0 : -1}
                  onClick={() => selectDate(d)}
                  onMouseEnter={() => { if (rangeAnchor) setHoverDate(d); }}
                >
                  {format(d, 'd')}
                  {isMarked && <span className="edp-day-dot" aria-hidden="true" />}
                </button>
              );
            })}
          </div>

          <div className="edp-pop-foot">
            <button type="button" className="edp-foot-btn" onClick={handleToday}>Today</button>
            <button type="button" className="edp-foot-btn" onClick={handleClear}>Clear</button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default EditorialDatePicker;

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import MonthCalendar, {
  MONTH_NAMES,
  toStr, fromStr, addMonths,
} from './MonthCalendar';

// Single-date popover used by the rota page's date stepper. Built on the
// shared MonthCalendar — single-date mode is range mode with start===end,
// which the calendar's CSS handles identically (cell renders as the orange
// selected pill).
//
// Props:
//   open      — boolean. When false, returns null.
//   value     — 'YYYY-MM-DD'. The currently selected date.
//   onChange  — (next) => void. Called with picked YYYY-MM-DD.
//   onClose   — () => void. Backdrop click + Esc + day-click close the popover.
//
// Privacy/defaults: opens on the month containing `value` (the currently
// selected date). Dates are plain local YYYY-MM-DD throughout — no UTC.

export default function MonthPicker({ open, value, onChange, onClose }) {
  const todayStr = toStr(new Date());

  // Visible month — initialised to value's month. Reset whenever the popover
  // re-opens so a chief who steps several months away then closes/reopens
  // doesn't see a stale month.
  const initialMonth = useMemo(() => {
    const anchor = value ? fromStr(value) : new Date();
    return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  }, [value, open]);
  const [month, setMonth] = useState(initialMonth);
  useEffect(() => { if (open) setMonth(initialMonth); }, [open, initialMonth]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const pick = (s) => {
    onChange?.(s);
    onClose?.();
  };

  return (
    <>
      <div className="mp-backdrop" onClick={onClose} />
      <div
        className="mp-popover"
        role="dialog"
        aria-modal="true"
        aria-label="Pick a date"
      >
        <div className="mp-header">
          <button
            type="button"
            className="dp-nav"
            aria-label="Previous month"
            onClick={() => setMonth((d) => addMonths(d, -1))}
          ><ChevronLeft size={16} /></button>
          <div className="mp-header-title">
            {MONTH_NAMES[month.getMonth()]} {month.getFullYear()}
          </div>
          <button
            type="button"
            className="dp-nav"
            aria-label="Next month"
            onClick={() => setMonth((d) => addMonths(d, 1))}
          ><ChevronRight size={16} /></button>
        </div>
        <MonthCalendar
          year={month.getFullYear()}
          month={month.getMonth()}
          startStr={value}
          endStr={value}
          todayStr={todayStr}
          onPick={pick}
          hideTitle
        />
        <div className="mp-footer">
          <button
            type="button"
            className="crew-rota-pill"
            onClick={() => pick(todayStr)}
          >Jump to today</button>
        </div>
      </div>
    </>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import MonthCalendar, {
  WEEKDAY_SHORT, MONTH_SHORT,
  pad, toStr, fromStr, addDays, addMonths, startOfThisWeekMonday,
} from './MonthCalendar';

// Cargo-styled date-range picker — reusable.
//
// Always-visible calendar (no separate "custom" mode). Two months side
// by side; left/right arrows shift the PAIR. Preset chips above are
// SHORTCUTS that set the highlighted range; direct day clicks override.
//
// CRITICAL date handling: every date in/out is a plain local
// 'YYYY-MM-DD' string. All Date construction uses local components
// (new Date(y, m, d) and getFullYear/getMonth/getDate). No toISOString
// anywhere — that would UTC-shift across midnight and reintroduce the
// off-by-one bug.
//
// Props:
//   value     — { start: 'YYYY-MM-DD' | null, end: 'YYYY-MM-DD' | null }
//   onChange  — (next) => void
//   trip      — { dateStart, dateEnd } | null (controls the Whole-trip chip)
//
// The month-grid view itself lives in ./MonthCalendar (also consumed by
// the single-date MonthPicker that powers the rota stepper's calendar
// popover) — kept identical here so behavior is unchanged after extraction.

function dayCount(startStr, endStr) {
  if (!startStr || !endStr || startStr > endStr) return 0;
  const a = fromStr(startStr);
  const b = fromStr(endStr);
  return Math.round((b - a) / 86_400_000) + 1;
}

function formatRange(startStr, endStr) {
  if (!startStr || !endStr) return null;
  const a = fromStr(startStr);
  const b = fromStr(endStr);
  const partA = `${WEEKDAY_SHORT[a.getDay()]} ${a.getDate()} ${MONTH_SHORT[a.getMonth()]}`;
  const partB = `${WEEKDAY_SHORT[b.getDay()]} ${b.getDate()} ${MONTH_SHORT[b.getMonth()]}`;
  const same = startStr === endStr;
  const days = dayCount(startStr, endStr);
  return same
    ? `${partA} · 1 day`
    : `${partA} – ${partB} · ${days} day${days === 1 ? '' : 's'}`;
}

export default function DateRangePicker({ value, onChange, trip }) {
  const todayStr = toStr(new Date());
  const startStr = value?.start || null;
  const endStr = value?.end || null;

  // Visible LEFT month — the right calendar always shows the next.
  const initialLeft = useMemo(() => {
    const anchor = startStr ? fromStr(startStr) : new Date();
    return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [leftMonth, setLeftMonth] = useState(initialLeft);

  // Click semantics:
  //   no start → set start, clear end (next click sets end)
  //   start, no end → if clicked < start: swap (new start = clicked).
  //                   else: end = clicked.
  //   both set → reset: start = clicked, end = null.
  const handlePick = (s) => {
    if (!startStr) {
      onChange?.({ start: s, end: null });
    } else if (!endStr) {
      if (s < startStr) onChange?.({ start: s, end: startStr });
      else if (s === startStr) onChange?.({ start: s, end: s });
      else onChange?.({ start: startStr, end: s });
    } else {
      onChange?.({ start: s, end: null });
    }
  };

  const setPreset = (kind) => {
    const today = new Date();
    if (kind === 'today') {
      onChange?.({ start: todayStr, end: todayStr });
      setLeftMonth(new Date(today.getFullYear(), today.getMonth(), 1));
      return;
    }
    if (kind === 'thisWeek') {
      const mon = startOfThisWeekMonday(today);
      onChange?.({ start: toStr(mon), end: toStr(addDays(mon, 6)) });
      setLeftMonth(new Date(mon.getFullYear(), mon.getMonth(), 1));
      return;
    }
    if (kind === 'nextWeek') {
      const mon = addDays(startOfThisWeekMonday(today), 7);
      onChange?.({ start: toStr(mon), end: toStr(addDays(mon, 6)) });
      setLeftMonth(new Date(mon.getFullYear(), mon.getMonth(), 1));
      return;
    }
    if (kind === 'wholeTrip' && trip?.dateStart && trip?.dateEnd) {
      onChange?.({ start: trip.dateStart, end: trip.dateEnd });
      const a = fromStr(trip.dateStart);
      setLeftMonth(new Date(a.getFullYear(), a.getMonth(), 1));
    }
  };

  // After the picker mounts with a value (or value changes externally),
  // make sure at least the start month is visible.
  useEffect(() => {
    if (!startStr) return;
    const start = fromStr(startStr);
    const startMonthStr = `${start.getFullYear()}-${pad(start.getMonth() + 1)}`;
    const leftStr = `${leftMonth.getFullYear()}-${pad(leftMonth.getMonth() + 1)}`;
    const rightDate = addMonths(leftMonth, 1);
    const rightStr = `${rightDate.getFullYear()}-${pad(rightDate.getMonth() + 1)}`;
    if (startMonthStr !== leftStr && startMonthStr !== rightStr) {
      setLeftMonth(new Date(start.getFullYear(), start.getMonth(), 1));
    }
  }, [startStr, leftMonth]);

  const rightMonth = addMonths(leftMonth, 1);
  const hasTrip = trip?.dateStart && trip?.dateEnd;
  const summary = formatRange(startStr, endStr);

  return (
    <div className="dp-wrap">
      <div className="dp-chips">
        <button type="button" className="crew-rota-pill"
          onClick={() => setPreset('today')}>Just today</button>
        <button type="button" className="crew-rota-pill"
          onClick={() => setPreset('thisWeek')}>This week</button>
        <button type="button" className="crew-rota-pill"
          onClick={() => setPreset('nextWeek')}>Next week</button>
        {hasTrip && (
          <button type="button" className="crew-rota-pill"
            onClick={() => setPreset('wholeTrip')}
            title={`${trip.dateStart} → ${trip.dateEnd}`}>
            Whole trip
          </button>
        )}
      </div>

      <div className="dp-calendars">
        <button
          type="button"
          className="dp-nav"
          aria-label="Previous month"
          onClick={() => setLeftMonth((d) => addMonths(d, -1))}
        ><ChevronLeft size={16} /></button>
        <MonthCalendar
          year={leftMonth.getFullYear()}
          month={leftMonth.getMonth()}
          startStr={startStr}
          endStr={endStr}
          todayStr={todayStr}
          onPick={handlePick}
        />
        <MonthCalendar
          year={rightMonth.getFullYear()}
          month={rightMonth.getMonth()}
          startStr={startStr}
          endStr={endStr}
          todayStr={todayStr}
          onPick={handlePick}
        />
        <button
          type="button"
          className="dp-nav"
          aria-label="Next month"
          onClick={() => setLeftMonth((d) => addMonths(d, 1))}
        ><ChevronRight size={16} /></button>
      </div>

      <div className="dp-summary">
        {summary || <em>Click a start day and an end day.</em>}
      </div>
    </div>
  );
}

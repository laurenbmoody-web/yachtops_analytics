import React, { useMemo } from 'react';

// Shared month-grid view used by both DateRangePicker (range picker on the
// apply modal) and MonthPicker (single-date popover on the rota stepper).
//
// CRITICAL date handling: every date in/out is a plain local 'YYYY-MM-DD'
// string. Construction uses local components (new Date(y, m, d) and
// getFullYear/getMonth/getDate). No toISOString anywhere.
//
// Range mode is the same component: startStr === endStr renders a single
// "is-start is-end" cell (CSS handles both classes identically). Single-
// date callers pass start === end === selectedDate.

export const WEEKDAYS_MON = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const pad = (n) => String(n).padStart(2, '0');
export const toStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromStr = (s) => {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (d, n) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
};
export const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
export const dayOfWeekMonday = (d) => {
  const w = d.getDay();
  return w === 0 ? 6 : w - 1;
};
export const startOfThisWeekMonday = (today = new Date()) => {
  const x = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  x.setDate(x.getDate() - dayOfWeekMonday(x));
  return x;
};

export function monthWeeks(year, month) {
  const first = new Date(year, month, 1);
  const lead = dayOfWeekMonday(first);
  const total = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let d = 1; d <= total; d += 1) cells.push(new Date(year, month, d));
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export default function MonthCalendar({ year, month, startStr, endStr, todayStr, onPick, hideTitle = false }) {
  const weeks = useMemo(() => monthWeeks(year, month), [year, month]);
  return (
    <div className="dp-month">
      {!hideTitle && <div className="dp-month-title">{MONTH_NAMES[month]} {year}</div>}
      <div className="dp-week-header">
        {WEEKDAYS_MON.map((w) => <div key={w} className="dp-wh">{w}</div>)}
      </div>
      <div className="dp-grid">
        {weeks.flat().map((cell, idx) => {
          if (cell == null) return <div key={`e-${idx}`} className="dp-cell dp-cell-empty" />;
          const s = toStr(cell);
          const isStart = startStr && s === startStr;
          const isEnd = endStr && s === endStr;
          const inRange = startStr && endStr && s > startStr && s < endStr;
          const isToday = todayStr && s === todayStr;
          const cls = ['dp-cell'];
          if (isStart) cls.push('is-start');
          if (isEnd) cls.push('is-end');
          if (inRange) cls.push('is-range');
          if (isToday) cls.push('is-today');
          return (
            <button
              key={s}
              type="button"
              className={cls.join(' ')}
              onClick={() => onPick(s)}
              aria-pressed={isStart || isEnd}
              aria-label={`${WEEKDAY_SHORT[cell.getDay()]} ${cell.getDate()} ${MONTH_NAMES[month]}`}
            >
              {cell.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

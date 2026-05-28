import React, { useMemo } from 'react';
import { DEPT_ORDER, MlcTriangle } from '../trip-detail-view-with-guest-allocation/sections/SectionCrew';
import { ON_DUTY_TYPES, assessMlc } from './restHours';
import { getContrastText } from './crewDisplay';

// Crew × 7-day operational matrix for the rota page's Week view.
//
// Rows are crew (dept-grouped, same DEPT_ORDER as the day grid). Columns are
// the 7 operational days (06:00 → 06:00 by default). The boundary is
// received via `gridStartHour` — same prop name and source the day grid
// uses, so when the vessel-configurable boundary lands later, flipping the
// single source feeds both views at once.
//
// Visual language mirrors RotaTodayGrid:
//   - Department vertical colour spine (.cw-dept-strip), sticky 22px,
//     rotated text. Colour from c.departmentColor (the same field useRota-
//     Shifts populates from tenant_members.departments.color — single source).
//   - Sticky name column with Name · Role one line + rest line, identical
//     to .rota-nm.
//   - Day cells use the day-grid palette: navy (#1C1B3A) for scheduled,
//     cream (#F7F5F0) for off, Saturday tint (#EDEAE3) for the weekend
//     column. No new colour ramps invented.
//   - DM Serif Display for the date numbers in headers; Plus Jakarta for
//     all body text. Matches .rota-hour-label / .rota-nm-name / .rota-role.
//
// Week-anchoring: the 7 columns are the trailing operational week ENDING
// at selectedDate (left = oldest, right = selectedDate). Aligns with
// useRotaShifts' rolling window so per-cell trailing-7 MLC fits inside
// the fetched windowShifts (the hook fetches historyDays=12 in week mode).
//
// Click a cell → onCellClick(date) — page sets selectedDate to that day
// and switches view to 'grid'.

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function pad2(n) { return String(n).padStart(2, '0'); }
function parseLocal(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function toLocalStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function addLocalDays(s, n) {
  const d = parseLocal(s);
  d.setDate(d.getDate() + n);
  return toLocalStr(d);
}
function fmtRest(decimal) {
  if (decimal == null) return null;
  const total = Math.max(0, Math.round(decimal * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h${pad2(m)}`;
}
function hhmm(t) { return t ? String(t).slice(0, 5) : ''; }
function isWeekend(dateStr) {
  const w = parseLocal(dateStr).getDay();
  return w === 0 || w === 6;
}

// Per (crew, day) summary for a single cell. Trailing-7 MLC sliced from
// the parent windowShifts.
function cellSummary(memberId, dateStr, windowShifts) {
  const dayShifts = windowShifts.filter(
    (s) => s.memberId === memberId && s.date === dateStr,
  );
  const weekStart = addLocalDays(dateStr, -6);
  const weekShifts = windowShifts.filter(
    (s) => s.memberId === memberId && s.date >= weekStart && s.date <= dateStr,
  );
  const onDuty = dayShifts.filter((s) => ON_DUTY_TYPES.has(s.shiftType));
  const isOff = onDuty.length === 0;
  const mlc = assessMlc({ dayShifts, weekShifts });
  return {
    onDuty,
    isOff,
    rest24h: isOff ? null : mlc.rest24h,
    mlcWarning: isOff ? false : mlc.anyBreach,
  };
}

function DayHeader({ dateStr, isToday, isSelected }) {
  const d = parseLocal(dateStr);
  const weekend = isWeekend(dateStr);
  const cls = ['cw-day-head'];
  if (isToday) cls.push('is-today');
  if (isSelected) cls.push('is-selected');
  if (weekend) cls.push('is-weekend');
  return (
    <div className={cls.join(' ')}>
      <div className="cw-day-head-dow">{WEEKDAY_SHORT[d.getDay()]}</div>
      <div className="cw-day-head-num">{d.getDate()}</div>
      <div className="cw-day-head-mon">{MONTH_SHORT[d.getMonth()]}</div>
    </div>
  );
}

function Cell({ summary, dateStr, isToday, isSelected, onClick, ariaLabel }) {
  const weekend = isWeekend(dateStr);
  const cls = ['cw-c'];
  if (summary.isOff) cls.push('off');
  else cls.push('f');
  if (weekend && summary.isOff) cls.push('sat');
  if (isToday) cls.push('is-today-col');
  if (isSelected) cls.push('is-selected-col');
  if (summary.mlcWarning) cls.push('is-warn');
  return (
    <button type="button" className={cls.join(' ')} onClick={onClick} aria-label={ariaLabel}>
      {summary.isOff ? (
        <span className="cw-c-off">off</span>
      ) : (
        <>
          <span className="cw-c-range">
            {hhmm(summary.onDuty[0].startTime)}–{hhmm(summary.onDuty[0].endTime)}
            {summary.onDuty.length > 1 && <span className="cw-c-more">+{summary.onDuty.length - 1}</span>}
          </span>
          <span className="cw-c-meta">
            <span className={`cw-c-rest${summary.mlcWarning ? ' w' : ''}`}>
              {fmtRest(summary.rest24h) || '—'}
            </span>
            {summary.mlcWarning && <MlcTriangle size={9} />}
          </span>
        </>
      )}
    </button>
  );
}

export default function CrewWeekMatrix({
  crew = [],
  windowShifts = [],
  selectedDate,
  realToday,
  // eslint-disable-next-line no-unused-vars
  gridStartHour = 6,
  onCellClick,
}) {
  // gridStartHour is received here through the same prop path the day grid
  // uses, so when the vessel-configurable boundary lands later, flipping
  // the single source feeds both views together. The matrix is keyed by
  // shift_date (rows already carry the date they started on, including
  // wrap-around shifts), so no slot-math currently consumes the value;
  // the prop is on the signature for the future-config wiring.

  // 7 columns = trailing operational week ending at selectedDate.
  const days = useMemo(() => {
    if (!selectedDate) return [];
    const out = [];
    for (let i = 6; i >= 0; i -= 1) out.push(addLocalDays(selectedDate, -i));
    return out;
  }, [selectedDate]);

  // Dept-grouped rows — match DEPT_ORDER, same as day grid.
  const grouped = useMemo(() => {
    const byDept = new Map();
    for (const c of crew) {
      const d = c.department || 'Other';
      if (!byDept.has(d)) byDept.set(d, []);
      byDept.get(d).push(c);
    }
    const ordered = [
      ...DEPT_ORDER.filter((d) => byDept.has(d)),
      ...Array.from(byDept.keys()).filter((d) => !DEPT_ORDER.includes(d)),
    ];
    return ordered.map((d) => [d, byDept.get(d)]);
  }, [crew]);

  if (!selectedDate || days.length === 0) return null;

  return (
    <div className="cw-grid-wrap">
      <div className="cw-grid-inner">
        <div className="cw-head-row">
          <div className="cw-head-spacer">Crew</div>
          {days.map((d) => (
            <DayHeader
              key={d}
              dateStr={d}
              isToday={d === realToday}
              isSelected={d === selectedDate}
            />
          ))}
        </div>

        {grouped.map(([dept, members]) => {
          const color = members[0]?.departmentColor || '#5F5E5A';
          return (
            <div key={dept} className="cw-dept-group">
              <div
                className="cw-dept-strip"
                style={{ background: color, color: getContrastText(color) }}
                role="rowheader"
                aria-label={`${dept} department`}
              >
                <span className="cw-dept-strip-text">{dept}</span>
              </div>
              <div className="cw-dept-rows">
                {members.map((c) => (
                  <div key={c.id} className="cw-row">
                    <div className="cw-nm">
                      <div className="cw-nm-line">
                        <span className="cw-nm-name">{c.name}</span>
                        <span className="cw-dot" />
                        <span className="cw-role">{c.role || ''}</span>
                        {c.mlcWarning && (
                          <span style={{ marginLeft: 4 }}><MlcTriangle size={10} /></span>
                        )}
                      </div>
                    </div>
                    {days.map((d) => {
                      const summary = cellSummary(c.id, d, windowShifts);
                      return (
                        <Cell
                          key={d}
                          summary={summary}
                          dateStr={d}
                          isToday={d === realToday}
                          isSelected={d === selectedDate}
                          onClick={() => onCellClick?.(d)}
                          ariaLabel={`${c.name} on ${d}`}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

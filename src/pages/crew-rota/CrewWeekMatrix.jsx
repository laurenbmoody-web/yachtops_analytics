import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Pencil } from 'lucide-react';
import { DEPT_ORDER, MlcTriangle } from '../trip-detail-view-with-guest-allocation/sections/SectionCrew';
import { ON_DUTY_TYPES, assessMlc } from './restHours';
import { getContrastText, getRoleDisplayName } from './crewDisplay';
import { MONTH_SHORT, MONTH_NAMES } from './MonthCalendar';

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

// Editorial label for the matrix's 7-day FORWARD range
// (selectedDate .. selectedDate+6). Same-month: "3–9 Jun".
// Cross-month: "30 May – 5 Jun". Day-first, no US format.
// Exported so the page stepper-helper uses the same source.
export function weekRangeLabel(selectedDate) {
  if (!selectedDate) return '';
  const start = parseLocal(selectedDate);
  const end = parseLocal(addLocalDays(selectedDate, 6));
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${start.getDate()}–${end.getDate()} ${MONTH_SHORT[start.getMonth()]}`;
  }
  return `${start.getDate()} ${MONTH_SHORT[start.getMonth()]} – ${end.getDate()} ${MONTH_SHORT[end.getMonth()]}`;
}

// Long-form label for the picker button itself in week mode — both ends
// shown in full (dow + day + month name).
// Same-month example:   "Thu 4 June — Wed 10 June"
// Cross-month example:  "Sat 28 June — Fri 4 July"
export function weekRangeLabelLong(selectedDate) {
  if (!selectedDate) return '';
  const start = parseLocal(selectedDate);
  const end = parseLocal(addLocalDays(selectedDate, 6));
  const fmt = (d) => `${WEEKDAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
  return `${fmt(start)} — ${fmt(end)}`;
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

function DayHeader({ dateStr, isToday, isSelected, isAffected }) {
  const d = parseLocal(dateStr);
  const weekend = isWeekend(dateStr);
  const cls = ['cw-day-head'];
  if (isToday) cls.push('is-today');
  if (isSelected) cls.push('is-selected');
  if (weekend) cls.push('is-weekend');
  if (isAffected) cls.push('is-affected');
  return (
    <div className={cls.join(' ')}>
      <div className="cw-day-head-dow">{WEEKDAY_SHORT[d.getDay()]}</div>
      <div className="cw-day-head-num">{d.getDate()}</div>
      <div className="cw-day-head-mon">{MONTH_SHORT[d.getMonth()]}</div>
    </div>
  );
}

function Cell({ summary, dateStr, isToday, isSelected, isAffected, isEdited, colorByType, onClick, ariaLabel }) {
  const weekend = isWeekend(dateStr);
  const cls = ['cw-c'];
  if (summary.isOff) cls.push('off');
  else cls.push('f');
  if (weekend && summary.isOff) cls.push('sat');
  if (isToday) cls.push('is-today-col');
  if (isSelected) cls.push('is-selected-col');
  if (isAffected) cls.push('is-affected');
  if (isEdited) cls.push('is-edited');
  if (colorByType && !summary.isOff) cls.push('cw-c--typed');
  if (summary.mlcWarning) cls.push('is-warn');

  // Multi-shift display: each block is its own stacked line — the gap between
  // shifts is exactly what MLC cares about, so we never collapse them. In the
  // type-coloured (History) view every block shows with its type bar; the live
  // view caps at two + a "+N more" tag.
  const visible = colorByType ? summary.onDuty : summary.onDuty.slice(0, 2);
  const extra = colorByType ? 0 : Math.max(0, summary.onDuty.length - 2);

  return (
    <button type="button" className={cls.join(' ')} onClick={onClick} aria-label={ariaLabel}>
      {isEdited && (
        <span className="cw-c-edited" aria-hidden="true"><Pencil size={10} strokeWidth={2.5} /></span>
      )}
      {summary.isOff ? (
        <span className="cw-c-off">off</span>
      ) : (
        <>
          <span className="cw-c-ranges">
            {visible.map((s, i) => (
              <span key={i} className="cw-c-range">
                {colorByType && (
                  <span className={`cw-c-bar cw-c-bar--${s.shiftType || 'duty'}`} aria-hidden="true" />
                )}
                {hhmm(s.startTime)}–{hhmm(s.endTime)}
              </span>
            ))}
            {extra > 0 && <span className="cw-c-more">+{extra} more</span>}
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
  onStepDay,
  affectedDates = [],
  dayList = null,
  editedCells = null,
  colorByType = false,
}) {
  // dayList: an explicit, possibly non-contiguous set of date columns (used by
  // the read-only history "dates affected only" filter). When provided it
  // overrides the 7-day forward window and the step controls are hidden.
  const customDays = Array.isArray(dayList) && dayList.length > 0;
  // editedCells: Set of "memberId|YYYY-MM-DD" the reviewer changed before
  // accepting (History view). Flagged cells get a pencil; clicking them calls
  // onCellClick(date, memberId, anchorRect) to reveal the original hours.
  const editedSet = useMemo(
    () => (editedCells instanceof Set ? editedCells : new Set(editedCells || [])),
    [editedCells],
  );
  // Dates to flag as "changed in this submission" (read-only history view).
  // Empty on the live grid, so this is a no-op there.
  const affectedSet = useMemo(() => new Set(affectedDates), [affectedDates]);
  // gridStartHour is received here through the same prop path the day grid
  // uses, so when the vessel-configurable boundary lands later, flipping
  // the single source feeds both views together. The matrix is keyed by
  // shift_date (rows already carry the date they started on, including
  // wrap-around shifts), so no slot-math currently consumes the value;
  // the prop is on the signature for the future-config wiring.

  // 7 columns = FORWARD operational week starting at selectedDate.
  // Leftmost = selectedDate, rightmost = selectedDate+6.
  const days = useMemo(() => {
    if (customDays) return [...dayList].sort();
    if (!selectedDate) return [];
    const out = [];
    for (let i = 0; i < 7; i += 1) out.push(addLocalDays(selectedDate, i));
    return out;
  }, [selectedDate, customDays, dayList]);

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

  if (days.length === 0) return null;

  return (
    <div className="cw-card">
      {!customDays && (
        <button
          type="button"
          className="cw-edge-step cw-edge-step-left"
          onClick={() => onStepDay?.(-1)}
          aria-label="Previous day"
          title="Slide window back one day"
        ><ChevronLeft size={16} /></button>
      )}

      <div className="cw-grid-wrap">
        <div className="cw-grid-inner" style={{ '--cw-cols': days.length }}>
          <div className="cw-head-row">
            <div className="cw-head-spacer">Crew</div>
            {days.map((d) => (
              <DayHeader
                key={d}
                dateStr={d}
                isToday={d === realToday}
                isSelected={d === selectedDate}
                isAffected={affectedSet.has(d)}
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
                        <span className="cw-role" title={c.role || ''}>
                          {getRoleDisplayName(c.role)}
                        </span>
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
                          isAffected={affectedSet.has(d)}
                          isEdited={editedSet.has(`${c.id}|${d}`)}
                          colorByType={colorByType}
                          onClick={(e) => onCellClick?.(d, c.id, e.currentTarget.getBoundingClientRect())}
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

      {!customDays && (
        <button
          type="button"
          className="cw-edge-step cw-edge-step-right"
          onClick={() => onStepDay?.(1)}
          aria-label="Next day"
          title="Slide window forward one day"
        ><ChevronRight size={16} /></button>
      )}
    </div>
  );
}

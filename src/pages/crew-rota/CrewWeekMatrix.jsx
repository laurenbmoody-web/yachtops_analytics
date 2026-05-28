import React, { useMemo } from 'react';
import { DEPT_ORDER, MlcTriangle } from '../trip-detail-view-with-guest-allocation/sections/SectionCrew';
import { ON_DUTY_TYPES, assessMlc } from './restHours';

// Crew × 7-day operational matrix for the rota page's Week view.
//
// Rows are crew (dept-grouped, same DEPT_ORDER as the day grid). Columns are
// the 7 operational days (06:00 → 06:00 by default — passed via the same
// `gridStartHour` prop that RotaTodayGrid takes, so when the vessel-
// configurable boundary feature lands later, both views switch at once).
//
// Week-anchoring (flagged in the commit body): the 7 columns are the
// trailing 7 days ENDING at selectedDate inclusive (left = oldest, right
// = selectedDate). Aligns with useRotaShifts' rolling window so the
// fetched data covers every cell's trailing-7 MLC rest calc, and composes
// smoothly with the ±1-day stepper (each step slides the whole matrix).
//
// Click a cell → onCellClick(date) — wired to: set selectedDate to that day
// and switch view to 'grid' (the day grid renders for the clicked day).
//
// Data is sliced from `windowShifts` (the hook's 13-day fetch when in week
// mode — historyDays=12 + selectedDate). Each cell computes its own
// trailing-7 MLC report inline. No new query, no new endpoint.

const SHIFT_COLORS = {
  duty: '#1C1B3A',
  watch: '#C65A1A',
  standby: '#B8935E',
  training: '#6B7F6B',
  medical: '#7A2E1E',
};
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

// Per (crew, day) summary for a single cell.
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
    primaryType: onDuty[0]?.shiftType || null,
    rest24h: isOff ? null : mlc.rest24h,
    mlcWarning: isOff ? false : mlc.anyBreach,
  };
}

function DayHeader({ dateStr, isToday, isSelected }) {
  const d = parseLocal(dateStr);
  const cls = ['cw-day-head'];
  if (isToday) cls.push('is-today');
  if (isSelected) cls.push('is-selected');
  return (
    <div className={cls.join(' ')}>
      <div className="cw-day-head-dow">{WEEKDAY_SHORT[d.getDay()]}</div>
      <div className="cw-day-head-num">
        {d.getDate()} <span className="cw-day-head-mon">{MONTH_SHORT[d.getMonth()]}</span>
      </div>
    </div>
  );
}

function CellContent({ summary }) {
  if (summary.isOff) {
    return <div className="cw-cell-off">off</div>;
  }
  const swatchColor = SHIFT_COLORS[summary.primaryType] || '#5F5E5A';
  const firstShift = summary.onDuty[0];
  const moreCount = summary.onDuty.length - 1;
  return (
    <>
      <div className="cw-cell-shifts">
        <span className="cw-cell-swatch" style={{ background: swatchColor }} />
        <span className="cw-cell-range">
          {hhmm(firstShift.startTime)}–{hhmm(firstShift.endTime)}
        </span>
        {moreCount > 0 && <span className="cw-cell-more">+{moreCount}</span>}
      </div>
      <div className="cw-cell-meta">
        <span className={`cw-cell-rest${summary.mlcWarning ? ' is-warn' : ''}`}>
          {fmtRest(summary.rest24h) || '—'}
        </span>
        {summary.mlcWarning && <MlcTriangle size={9} />}
      </div>
    </>
  );
}

export default function CrewWeekMatrix({
  crew = [],
  windowShifts = [],
  selectedDate,
  realToday,
  gridStartHour = 6, // received via same prop path as RotaTodayGrid
  onCellClick,
}) {
  // Boundary parameter is received as a prop — currently a fixed 6 from
  // the page, but the plumbing is in place for the future vessel-
  // configurable boundary feature. Not used in any visual computation
  // today (the cell renders are date-keyed, the operational boundary
  // matters only for shift wrap-around which the day-keyed slice already
  // resolves correctly when shifts cross midnight — those rows still
  // carry the shift_date they started on). Kept on the prop signature so
  // the future-config wiring lands by changing one call site.
  // eslint-disable-next-line no-unused-vars
  const _gridStartHour = gridStartHour;

  // 7 columns = trailing operational week ending at selectedDate.
  const days = useMemo(() => {
    if (!selectedDate) return [];
    const out = [];
    for (let i = 6; i >= 0; i -= 1) out.push(addLocalDays(selectedDate, -i));
    return out;
  }, [selectedDate]);

  // Dept-grouped rows — match the list/day-grid grouping.
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
    <div className="cw-wrap">
      <div className="cw-grid" role="grid" aria-label="Week roster">
        <div className="cw-row cw-header-row" role="row">
          <div className="cw-name-col cw-header-name" role="columnheader">Crew</div>
          {days.map((d) => (
            <DayHeader
              key={d}
              dateStr={d}
              isToday={d === realToday}
              isSelected={d === selectedDate}
            />
          ))}
        </div>

        {grouped.map(([dept, members]) => (
          <React.Fragment key={dept}>
            <div className="cw-row cw-dept-row" role="row">
              <div className="cw-dept-label">{dept} · {members.length} crew</div>
              <div className="cw-dept-rule" style={{ gridColumn: `2 / span ${days.length}` }} />
            </div>
            {members.map((c) => (
              <div key={c.id} className="cw-row" role="row">
                <div className="cw-name-col" role="rowheader">
                  <div className="cw-name">
                    {c.name}
                    {c.mlcWarning && <span className="cw-name-warn"><MlcTriangle size={10} /></span>}
                  </div>
                  <div className="cw-role">{c.role || ''}</div>
                </div>
                {days.map((d) => {
                  const summary = cellSummary(c.id, d, windowShifts);
                  const cls = [
                    'cw-cell',
                    summary.isOff ? 'is-off' : '',
                    summary.mlcWarning ? 'is-warn' : '',
                    d === realToday ? 'is-today-col' : '',
                    d === selectedDate ? 'is-selected-col' : '',
                  ].filter(Boolean).join(' ');
                  return (
                    <button
                      key={d}
                      type="button"
                      className={cls}
                      role="gridcell"
                      onClick={() => onCellClick?.(d)}
                      aria-label={`${c.name} on ${d}`}
                    >
                      <CellContent summary={summary} />
                    </button>
                  );
                })}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

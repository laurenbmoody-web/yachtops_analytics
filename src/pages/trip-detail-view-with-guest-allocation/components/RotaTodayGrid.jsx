import React from 'react';
import { MOCK_CREW } from '../sections/SectionCrew';

// ── Time / shift helpers ────────────────────────────────────────────────────
//
// The grid covers a 24-hour window from 04:00 Friday → 04:00 Saturday, in
// 48 half-hour slots. Slot index 0 = 04:00; slot 28 = 18:00; slot 40 = 00:00
// the next day. Cells in slots 40..47 are "tomorrow" cells (cream tint).
//
// Shifts are passed as { start, end } in 24h decimal hours (e.g. 8 = 08:00,
// 7.5 = 07:30, 22 = 22:00). `shiftToSlots` returns the slot index range.

const GRID_START_HOUR = 4;       // 04:00 = slot 0
const SLOTS = 48;                // 48 * 30 min = 24 h
const TOMORROW_FIRST_SLOT = 40;  // 00:00 the next day

function shiftToSlotRange({ start, end }) {
  // (hour - 4) * 2 → first slot; end slot is exclusive of `end` itself.
  const s = Math.max(0, Math.round((start - GRID_START_HOUR) * 2));
  const e = Math.min(SLOTS, Math.round((end - GRID_START_HOUR) * 2));
  return [s, e];
}

function isSlotInAnyShift(slotIdx, shifts) {
  if (!Array.isArray(shifts)) return false;
  for (const sh of shifts) {
    const [s, e] = shiftToSlotRange(sh);
    if (slotIdx >= s && slotIdx < e) return true;
  }
  return false;
}

// Convert the current wall-clock time into a slot index in [0, 48). Returns
// null if outside the grid window.
function nowSlot(now = new Date()) {
  const h = now.getHours();
  const m = now.getMinutes();
  // Decimal hour, but always within the 24h window starting at 04:00.
  // After midnight (00..03), slot = (24 + h - 4) * 2 + (m >= 30 ? 1 : 0).
  let slot;
  if (h >= GRID_START_HOUR) {
    slot = (h - GRID_START_HOUR) * 2 + (m >= 30 ? 1 : 0);
  } else {
    slot = (24 - GRID_START_HOUR + h) * 2 + (m >= 30 ? 1 : 0);
  }
  if (slot < 0 || slot >= SLOTS) return null;
  return slot;
}

// ── Hour header ─────────────────────────────────────────────────────────────

function HourHeader({ currentHour }) {
  const hours = [];
  for (let i = 0; i < 24; i += 1) {
    const h = (GRID_START_HOUR + i) % 24;
    const isTomorrow = i >= 20; // 00, 01, 02, 03 are next day
    const isNow = h === currentHour;
    const label = String(h).padStart(2, '0');
    const cls = ['rota-hour-label'];
    if (isNow) cls.push('now');
    if (isTomorrow) cls.push('tomorrow');
    hours.push(<div key={i} className={cls.join(' ')}>{label}</div>);
  }
  return (
    <div className="rota-header-row">
      <div className="rota-header-label">Crew · Friday → Saturday</div>
      {hours}
    </div>
  );
}

// ── Rest line on the name cell (3rd line: "Rest Xh | Past week Yh") ────────

function RestLine({ rest24h, pastWeek, warning }) {
  if (!rest24h && !pastWeek) {
    return <div className="rota-rest-line">Off today</div>;
  }
  return (
    <div className={`rota-rest-line${warning ? ' warning' : ''}`}>
      Rest <span className={`rota-rest-num${warning ? ' warning' : ''}`}>{rest24h || '—'}</span>
      <span className={`rota-rest-pipe${warning ? ' warning' : ''}`}>|</span>
      Past week <span className="rota-rest-num">{pastWeek || '—'}</span>
    </div>
  );
}

const MlcTriangle = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
    stroke="#C65A1A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);

// ── Crew row ────────────────────────────────────────────────────────────────

function CrewRow({ crew, currentSlot }) {
  const cells = [];
  for (let i = 0; i < SLOTS; i += 1) {
    const filled = isSlotInAnyShift(i, crew.shifts);
    const isHourTick = i % 2 === 1;
    const isTomorrow = i >= TOMORROW_FIRST_SLOT;
    const isNowCell = i === currentSlot;

    const cls = ['rota-cell'];
    if (isHourTick) cls.push('hour-tick');
    if (isTomorrow) cls.push('tomorrow');
    if (filled) cls.push('filled');
    if (isNowCell && filled && !isTomorrow) {
      // Per reference: at the "now" slot, the half-hour cell is highlighted
      // terracotta when the crew is scheduled there. Outside their shift,
      // the now slot stays at its base styling.
      cls.push('now');
    }
    cells.push(<div key={i} className={cls.join(' ')} />);
  }

  const isOffDay = crew.offToday;
  const isOnNowRow = !isOffDay && crew.onNow;
  const isWarningRow = crew.mlcWarning;

  const nameCls = ['rota-name'];
  if (isWarningRow) nameCls.push('warning-row');
  else if (isOnNowRow) nameCls.push('now-row');

  return (
    <div className={`rota-row${isOffDay ? ' off-day' : ''}`}>
      <div className={nameCls.join(' ')}>
        <div className="rota-name-title">
          {crew.name}
          {isWarningRow && <MlcTriangle />}
        </div>
        <div className="rota-name-role">{crew.role}</div>
        <RestLine rest24h={crew.rest24h} pastWeek={crew.pastWeek} warning={isWarningRow} />
      </div>
      {cells}
    </div>
  );
}

// ── Totals row ──────────────────────────────────────────────────────────────

function TotalsRow({ crew }) {
  const cells = [];
  for (let i = 0; i < SLOTS; i += 1) {
    let onDuty = 0;
    for (const c of crew) {
      if (c.offToday) continue;
      if (isSlotInAnyShift(i, c.shifts)) onDuty += 1;
    }
    const isHourTick = i % 2 === 1;
    const isTomorrow = i >= TOMORROW_FIRST_SLOT;
    const cls = ['rota-totals-cell'];
    if (isHourTick) cls.push('hour-tick');
    if (isTomorrow) cls.push('tomorrow');
    if (onDuty === 0) cls.push('empty-shift');
    if (onDuty >= 4) cls.push('heavy');
    cells.push(
      <div key={i} className={cls.join(' ')}>{onDuty || '·'}</div>
    );
  }
  return (
    <div className="rota-totals-row">
      <div className="rota-totals-name">On duty</div>
      {cells}
    </div>
  );
}

// ── Department section ──────────────────────────────────────────────────────

function DepartmentSection({ label, crew, currentSlot }) {
  return (
    <>
      <div className="rota-dept-row">
        <div className="rota-dept">{label}</div>
        <div className="rota-dept-rule" />
      </div>
      {crew.map(c => <CrewRow key={c.id} crew={c} currentSlot={currentSlot} />)}
    </>
  );
}

// ── Grid ────────────────────────────────────────────────────────────────────

const DEPT_ORDER = ['Interior', 'Deck', 'Galley', 'Engineering'];

export default function RotaTodayGrid({ now = new Date() }) {
  const crew = MOCK_CREW;
  const currentSlot = nowSlot(now);
  const currentHour = now.getHours();

  const byDept = new Map();
  for (const c of crew) {
    const d = c.department || 'Other';
    if (!byDept.has(d)) byDept.set(d, []);
    byDept.get(d).push(c);
  }
  const orderedDepts = [
    ...DEPT_ORDER.filter(d => byDept.has(d)),
    ...Array.from(byDept.keys()).filter(d => !DEPT_ORDER.includes(d)),
  ];

  // Now-line position: 220px name col + (currentSlot / 48) of the remaining
  // grid width. The CSS-grid columns past the name are `repeat(48, ...)` so
  // we approximate the line position with a CSS calc.
  const nowLineStyle = currentSlot != null
    ? { left: `calc(220px + (${currentSlot + 0.5} / 48) * (100% - 220px))` }
    : null;

  return (
    <div className="rota-grid-wrap">
      <div className="rota-grid-inner">
        <HourHeader currentHour={currentHour} />
        {orderedDepts.map(dept => (
          <DepartmentSection
            key={dept}
            label={dept}
            crew={byDept.get(dept)}
            currentSlot={currentSlot}
          />
        ))}
        <TotalsRow crew={crew} />
        {nowLineStyle && <div className="rota-now-line" style={nowLineStyle} />}
      </div>
    </div>
  );
}

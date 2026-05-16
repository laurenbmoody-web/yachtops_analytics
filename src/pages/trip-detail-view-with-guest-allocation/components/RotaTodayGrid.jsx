import React from 'react';
import { getRoleDisplayName } from '../../crew-rota/crewDisplay';

// ── Time / shift helpers ────────────────────────────────────────────────────
//
// The grid covers a 24-hour window starting at `gridStartHour` (default
// 06:00 Fri → 06:00 Sat) in 48 half-hour slots. Slot 0 = gridStartHour.
// Slots from the next calendar midnight onward are "Saturday" slots
// (slightly darker cream). Shifts are { start, end, type } in 24h decimal
// hours (8 = 08:00, 7.5 = 07:30); type is the shift taxonomy label.

const SLOTS = 48;

function shiftToSlotRange({ start, end }, gridStartHour) {
  const s = Math.max(0, Math.round((start - gridStartHour) * 2));
  const e = Math.min(SLOTS, Math.round((end - gridStartHour) * 2));
  return [s, e];
}

function isSlotInAnyShift(slotIdx, shifts, gridStartHour) {
  if (!Array.isArray(shifts)) return false;
  for (const sh of shifts) {
    const [s, e] = shiftToSlotRange(sh, gridStartHour);
    if (slotIdx >= s && slotIdx < e) return true;
  }
  return false;
}

// First slot that falls on the next calendar day (Saturday).
function saturdayFirstSlot(gridStartHour) {
  return (24 - gridStartHour) * 2;
}

// Current wall-clock time → slot index in [0, 48), or null if outside.
function nowSlot(now, gridStartHour) {
  const h = now.getHours();
  const m = now.getMinutes();
  let slot;
  if (h >= gridStartHour) {
    slot = (h - gridStartHour) * 2 + (m >= 30 ? 1 : 0);
  } else {
    slot = (24 - gridStartHour + h) * 2 + (m >= 30 ? 1 : 0);
  }
  if (slot < 0 || slot >= SLOTS) return null;
  return slot;
}

// ── Hour header ─────────────────────────────────────────────────────────────

function HourHeader({ gridStartHour, currentHour }) {
  const labels = [];
  for (let i = 0; i < 24; i += 1) {
    const h = (gridStartHour + i) % 24;
    const isTomorrow = (gridStartHour + i) >= 24;
    const isNow = h === currentHour;
    const cls = ['rota-hour-label'];
    if (isNow) cls.push('now');
    if (isTomorrow) cls.push('tm');
    labels.push(
      <div key={i} className={cls.join(' ')}>{String(h).padStart(2, '0')}</div>
    );
  }
  return (
    <div className="rota-hour-row">
      <div className="rota-hour-spacer">Crew</div>
      {labels}
    </div>
  );
}

// ── Name cell pieces ────────────────────────────────────────────────────────

const MlcTriangle = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
    stroke="#C65A1A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0, marginLeft: 4 }}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);

function RestLine({ rest24h, pastWeek, warning }) {
  // Off-duty on-board: no rest figures to show.
  if (!rest24h && !pastWeek) {
    return <div className="rota-nm-rest">Off duty · on-board</div>;
  }
  return (
    <div className={`rota-nm-rest${warning ? ' w' : ''}`}>
      Rest <b>{rest24h || '—'}</b>
      <span className="rota-pipe">·</span>
      <b>{pastWeek || '—'}</b> / 77h
    </div>
  );
}

// ── Crew row ────────────────────────────────────────────────────────────────

function CrewRow({ crew, gridStartHour, onCrewClick }) {
  const satStart = saturdayFirstSlot(gridStartHour);
  const cells = [];
  for (let i = 0; i < SLOTS; i += 1) {
    const filled = isSlotInAnyShift(i, crew.shifts, gridStartHour);
    const isSat = i >= satStart;
    const cls = ['rota-c'];
    if (filled) cls.push('f');
    else if (isSat) cls.push('sat');
    cells.push(<div key={i} className={cls.join(' ')} />);
  }

  const isOffDay = crew.offToday;
  const isWarning = crew.mlcWarning;

  return (
    <div className={`rota-row${isOffDay ? ' off' : ''}`}>
      <div
        className="rota-nm"
        onClick={onCrewClick ? () => onCrewClick(crew) : undefined}
        role={onCrewClick ? 'button' : undefined}
        tabIndex={onCrewClick ? 0 : undefined}
        onKeyDown={onCrewClick ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCrewClick(crew); }
        } : undefined}
      >
        <div className="rota-nm-line">
          <span className="rota-nm-name">{crew.name}</span>
          <span className="rota-dot" />
          <span className="rota-role">{getRoleDisplayName(crew.role)}</span>
          {isWarning && <MlcTriangle />}
        </div>
        <RestLine rest24h={crew.rest24h} pastWeek={crew.pastWeek} warning={isWarning} />
      </div>
      {cells}
    </div>
  );
}

// ── Totals row ──────────────────────────────────────────────────────────────

function TotalsRow({ crew, gridStartHour }) {
  const cells = [];
  for (let i = 0; i < SLOTS; i += 1) {
    let onDuty = 0;
    for (const c of crew) {
      if (c.offToday) continue;
      if (isSlotInAnyShift(i, c.shifts, gridStartHour)) onDuty += 1;
    }
    const cls = ['rota-t'];
    if (onDuty > 0) cls.push('has');
    if (onDuty >= 4) cls.push('heavy');
    cells.push(<div key={i} className={cls.join(' ')}>{onDuty || ''}</div>);
  }
  return (
    <div className="rota-totals">
      <div className="rota-totals-label">On duty</div>
      {cells}
    </div>
  );
}

// ── Department section ──────────────────────────────────────────────────────

function DepartmentSection({ label, crew, gridStartHour, onCrewClick }) {
  return (
    <>
      <div className="rota-dept-row">
        <div className="rota-dept">{label}</div>
        <div className="rota-dept-rule" />
      </div>
      {crew.map(c => (
        <CrewRow key={c.id} crew={c} gridStartHour={gridStartHour} onCrewClick={onCrewClick} />
      ))}
    </>
  );
}

// ── Grid ────────────────────────────────────────────────────────────────────

const DEPT_ORDER = ['Interior', 'Deck', 'Galley', 'Engineering'];

export default function RotaTodayGrid({ crew = [], now = new Date(), onCrewClick, gridStartHour = 6 }) {
  const currentSlot = nowSlot(now, gridStartHour);
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

  // Adaptive crew-column width (Correction 4). Pure CSS can't fit a
  // shared content width across the many independent .rota-row grids,
  // so measure the longest "Name · Role" string heuristically and pin
  // a clamped px width as a CSS var the sticky tracks all reference —
  // this keeps every row's first column identical (sticky alignment).
  // ~6.6px/char @13px + fixed chrome (padding 24 + dot/gaps ~20 + MLC
  // triangle slack ~16); clamped to [220, 320].
  const longestChars = crew.reduce((mx, c) => {
    const chars = String(c.name || '').length + getRoleDisplayName(c.role).length;
    return Math.max(mx, chars);
  }, 0);
  const nameColW = Math.max(220, Math.min(320, Math.round(60 + longestChars * 6.6)));
  const innerStyle = { '--rota-nm-w': `${nameColW}px` };

  // Now-line: name col (the CSS var) + (slot / 48) of the remaining
  // width. Gaps are 2px and ignored here — within a pixel of prior.
  const nowLineStyle = currentSlot != null
    ? { left: `calc(var(--rota-nm-w, 220px) + (${currentSlot + 0.5} / 48) * (100% - var(--rota-nm-w, 220px)))` }
    : null;

  return (
    <div className="rota-grid-wrap">
      <div className="rota-grid-inner" style={innerStyle}>
        <HourHeader gridStartHour={gridStartHour} currentHour={currentHour} />
        {orderedDepts.map(dept => (
          <DepartmentSection
            key={dept}
            label={dept}
            crew={byDept.get(dept)}
            gridStartHour={gridStartHour}
            onCrewClick={onCrewClick}
          />
        ))}
        <TotalsRow crew={crew} gridStartHour={gridStartHour} />
        {nowLineStyle && <div className="rota-now-line" style={nowLineStyle} />}
      </div>
    </div>
  );
}

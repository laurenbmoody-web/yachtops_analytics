import React, { useState, useRef, useCallback } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { getRoleDisplayName, getContrastText, getRoleRank, UNKNOWN_RANK } from '../../crew-rota/crewDisplay';

// currentStatus → section. null history falls back to on-vessel
// (treat unknown as active until we know otherwise).
const OFF_VESSEL_STATUSES = new Set([
  'on_leave', 'rotational_leave', 'medical_leave', 'training_leave', 'travelling', 'invited',
]);
const OFF_VESSEL_LABEL = {
  on_leave: 'On leave',
  rotational_leave: 'Rotational leave',
  medical_leave: 'Medical leave',
  training_leave: 'Training leave',
  travelling: 'Travelling',
  invited: 'Invited',
};
// Department canonical fallback order (signed-in-user rules layered on top).
const CANONICAL_DEPTS = ['Deck', 'Interior', 'Galley', 'Engineering', 'Bridge', 'Shore'];

// On-vessel render state from today's shift.
function renderStateOf(crew) {
  if (crew.activeOnShift) return 'active';
  if (crew.medicalToday) return 'medical';
  return 'off'; // shift_type 'off' OR no shift row
}
const STATE_RANK = { active: 0, off: 1, medical: 2 };

function sortWithinDept(a, b) {
  const sa = STATE_RANK[renderStateOf(a)];
  const sb = STATE_RANK[renderStateOf(b)];
  if (sa !== sb) return sa - sb;
  const ra = getRoleRank(a.role);
  const rb = getRoleRank(b.role);
  if (ra !== rb) return ra - rb;
  if (ra === UNKNOWN_RANK) {
    const byRole = String(a.role || '').localeCompare(String(b.role || ''));
    if (byRole !== 0) return byRole;
  }
  return String(a.name || '').localeCompare(String(b.name || ''));
}

function firstName(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }

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

// Slot span [sSlot, eSlot) of a raw rota_shifts row, overnight-aware
// (mirrors deriveCrew). Drives per-type cell colour + hole-punch math.
function rawShiftSpan(s, gridStartHour) {
  const toDec = (t) => {
    if (!t) return null;
    const [h, m] = String(t).split(':').map(Number);
    return h + (m || 0) / 60;
  };
  let st = toDec(s.startTime);
  let en = toDec(s.endTime);
  if (st == null || en == null) return null;
  if (en <= st) en += 24;
  return {
    sSlot: Math.round((st - gridStartHour) * 2),
    eSlot: Math.round((en - gridStartHour) * 2), // exclusive
    shift: s,
  };
}

// The raw shift covering a given slot for this crew member (or null).
function coveringSpan(crew, slot, gridStartHour) {
  for (const s of crew.rawShifts || []) {
    const sp = rawShiftSpan(s, gridStartHour);
    if (sp && slot >= sp.sSlot && slot < sp.eSlot) return sp;
  }
  return null;
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

function RestLine({ crew, mode, statusLabel }) {
  if (mode === 'offvessel') {
    return <div className="rota-nm-rest">{statusLabel}</div>;
  }
  if (mode === 'medical') {
    return <div className="rota-nm-rest">Medical · on-board</div>;
  }
  if (mode === 'off') {
    return <div className="rota-nm-rest">Off duty · on-board</div>;
  }
  const { rest24h, pastWeek, mlcWarning } = crew;
  return (
    <div className={`rota-nm-rest${mlcWarning ? ' w' : ''}`}>
      Rest <b>{rest24h || '—'}</b>
      <span className="rota-pipe">·</span>
      <b>{pastWeek || '—'}</b> / 77h
    </div>
  );
}

// ── Crew row ────────────────────────────────────────────────────────────────

// mode: 'active' | 'off' | 'medical' (on-vessel) | 'offvessel'
function CrewRow({
  crew, gridStartHour, onCrewClick, mode = 'active', statusLabel,
  editMode = false, onCellPointerDown, onCellPointerEnter, onCellKey, dragRange,
  highlightSlots, viewDate,
}) {
  const satStart = saturdayFirstSlot(gridStartHour);
  // Phase 1: cell editing is enabled for on-vessel department rows only
  // (off-vessel crew have no department-today context — see report).
  const cellEditable = editMode && mode !== 'offvessel' && !!onCellPointerDown;
  const cells = [];
  for (let i = 0; i < SLOTS; i += 1) {
    // Colour by the stored shift_type of whatever raw shift covers this
    // slot (any type incl. off/medical), not just on-duty ranges.
    const cover = coveringSpan(crew, i, gridStartHour);
    const isSat = i >= satStart;
    const inPreview = dragRange && i >= dragRange.lo && i <= dragRange.hi;
    const cls = ['rota-c'];
    if (cover) cls.push(`shift-cell--${cover.shift.shiftType || 'duty'}`);
    else if (isSat) cls.push('sat');
    // Per-cell pending marker: a draft (unpublished) shift gets the diagonal
    // hatch, a published one stays solid. On a brand-new submission every
    // shift is draft (all hatched); on an edited-published rota only the
    // changed cells are draft, so the chief sees exactly what's new.
    if (cover && cover.shift.status === 'draft') cls.push('is-draft');
    // Reviewer-edit callout: cells the chief/command added, retyped or erased
    // pulse when the HOD follows an "accepted with edits" notification. Keyed
    // by cell coords (member|date|slot), so erased — now empty — cells ring too.
    if (highlightSlots && viewDate && highlightSlots.has(`${crew.id}|${viewDate}|${i}`)) {
      cls.push('is-changed');
    }
    if (cellEditable) cls.push('rota-c-edit');
    if (inPreview) cls.push('rota-c-drag');                 // paint preview
    cells.push(
      <div
        key={i}
        className={cls.join(' ')}
        role={cellEditable ? 'button' : undefined}
        tabIndex={cellEditable ? 0 : undefined}
        aria-label={cellEditable ? `Slot ${i} for ${crew.name}` : undefined}
        onPointerDown={cellEditable ? (e) => {
          e.preventDefault();
          // Release implicit pointer capture so pointerenter fires on
          // sibling cells during a TOUCH drag (else mobile can't paint).
          try {
            if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          } catch { /* no-op */ }
          onCellPointerDown(crew, i);
        } : undefined}
        onPointerEnter={cellEditable ? () => onCellPointerEnter(crew, i) : undefined}
        onKeyDown={cellEditable ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCellKey(crew, i); }
        } : undefined}
      />,
    );
  }

  const isWarning = mode === 'active' && crew.mlcWarning;
  const rowCls = [
    'rota-row',
    mode === 'off' ? 'dim-off' : '',
    mode === 'medical' ? 'dim-off is-medical' : '',
    mode === 'offvessel' ? 'dim-offvessel' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={rowCls}>
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
        <RestLine crew={crew} mode={mode} statusLabel={statusLabel} />
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
// A 22px sticky vertical strip carries the department name (rotated),
// spanning the full height of the group. Background = the group's
// departmentColor; text colour auto-contrasts. The strip replaces the
// old eyebrow row AND the Phase-2 per-cell left border.

const DEPT_BADGE_LABEL = {
  draft: 'Draft',
  pending_approval: 'Pending',
  published: 'Published',
};

function DepartmentSection({
  deptName, crew, gridStartHour, onCrewClick,
  editMode = false, deptStatusRow, canSeeUnpublished = false,
  onCellPointerDown, onCellPointerEnter, onCellKey, drag,
  highlightSlots, viewDate,
}) {
  const color = crew[0]?.departmentColor || '#5F5E5A';
  const badge = deptStatusRow?.status
    ? (DEPT_BADGE_LABEL[deptStatusRow.status] || deptStatusRow.status)
    : null;
  // A published dept with edits not yet re-published — shown only to the
  // dept's CHIEF / owning HOD / COMMAND (canSeeUnpublished).
  const showUnpublished = deptStatusRow?.status === 'published'
    && deptStatusRow?.hasUnpublishedChanges
    && canSeeUnpublished;
  return (
    <div className="rota-dept-group">
      {(badge || showUnpublished) && (
        <div className="rota-dept-badges">
          {badge && (
            <div className={`rota-dept-badge st-${deptStatusRow.status}`}>
              {badge}
            </div>
          )}
          {showUnpublished && (
            <div className="rota-dept-badge st-unpublished" title="Edits made since this rota was published — not yet re-published">
              Unpublished changes
            </div>
          )}
        </div>
      )}
      <div className="rota-dept-body">
        <div
          className="rota-dept-strip"
          style={{ background: color, color: getContrastText(color) }}
          role="rowheader"
          aria-label={`${deptName} department${badge ? ` — ${badge}` : ''}`}
        >
          <span className="rota-dept-strip-text">{deptName}</span>
        </div>
        <div className="rota-dept-rows">
          {crew.map(c => (
            <CrewRow
              key={c.id}
              crew={c}
              gridStartHour={gridStartHour}
              onCrewClick={onCrewClick}
              mode={renderStateOf(c)}
              editMode={editMode}
              onCellPointerDown={onCellPointerDown}
              onCellPointerEnter={onCellPointerEnter}
              onCellKey={onCellKey}
              dragRange={drag && drag.crewId === c.id
                ? { lo: Math.min(drag.start, drag.cur), hi: Math.max(drag.start, drag.cur) }
                : null}
              highlightSlots={highlightSlots}
              viewDate={viewDate}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Off-vessel section ──────────────────────────────────────────────────────
// No strip, no coloured border — these crew aren't on a department
// today. Eyebrow header + each row at 0.4 opacity, status label in
// place of the rest line, sorted alphabetically by first name.

function OffVesselSection({ crew, gridStartHour, onCrewClick }) {
  if (crew.length === 0) return null;
  const sorted = [...crew].sort((a, b) =>
    firstName(a.name).localeCompare(firstName(b.name)));
  return (
    <div className="rota-offvessel">
      <div className="rota-offvessel-eyebrow">Off vessel</div>
      {sorted.map(c => (
        <CrewRow
          key={c.id}
          crew={c}
          gridStartHour={gridStartHour}
          onCrewClick={onCrewClick}
          mode="offvessel"
          statusLabel={OFF_VESSEL_LABEL[c.currentStatus] || 'Off vessel'}
        />
      ))}
    </div>
  );
}

// ── Grid ────────────────────────────────────────────────────────────────────

// Department order for the signed-in user: their own department first — so
// EVERY tier (COMMAND included) sees their own rota at the top — then the
// remaining departments in canonical order. A user with no/absent own
// department falls back to plain canonical order.
function orderDepartments(byDept, crew, ownDeptId) {
  const present = Array.from(byDept.keys());
  const canonIdx = (n) => {
    const i = CANONICAL_DEPTS.indexOf(n);
    return i === -1 ? 999 : i;
  };
  const canonicalSort = (a, b) => canonIdx(a) - canonIdx(b) || a.localeCompare(b);

  let ownDeptName = null;
  if (ownDeptId) {
    const m = crew.find(c => c.departmentId === ownDeptId);
    ownDeptName = m?.department || null;
  }

  if (!ownDeptName || !byDept.has(ownDeptName)) {
    return [...present].sort(canonicalSort);
  }
  const rest = present.filter(d => d !== ownDeptName).sort(canonicalSort);
  return [ownDeptName, ...rest];
}

export default function RotaTodayGrid({
  crew = [], now = new Date(), onCrewClick, gridStartHour = 6,
  editMode = false, onPaint, editableDeptIds = null,
  deptStatus, highlightSlots = null, viewDate = null,
}) {
  // editableDeptIds: Set of department ids the viewer may edit, or null = all
  // editable (COMMAND). Departments outside the set render read-only even in
  // edit mode (e.g. a chief who's expanded another department for context).
  // `now = null` suppresses the wall-clock indicator entirely — used when
  // the page is showing a non-today date, where a "now" line would be
  // visually misleading (the data isn't from today).
  const showNow = now != null;
  const { user, currentUser, tenantRole } = useAuth();

  // Who may see a dept's "unpublished changes" badge: COMMAND (any dept), or
  // the CHIEF / owning HOD of that dept (i.e. the viewer's own department).
  const viewerTier = String(user?.permission_tier || tenantRole || '').toUpperCase();
  const viewerDeptId = currentUser?.department_id || null;

  // ── Paint-brush drag ──────────────────────────────────────────────────────
  // Pointer down → begin; pointer enter cells in the SAME row → extend
  // preview; pointer up inside the grid → call onPaint(crew, lo, hi) once
  // for the whole range; pointer leaving the grid → cancel. Drag is
  // row-scoped (different crew ignored). Single click is just a range
  // where lo === hi. The active "brush" (shift type / Erase) lives at the
  // page level; the grid is paint-action-agnostic.
  const [drag, setDragState] = useState(null);
  const dragRef = useRef(null);
  const setDrag = useCallback((v) => {
    dragRef.current = typeof v === 'function' ? v(dragRef.current) : v;
    setDragState(dragRef.current);
  }, []);

  const beginDrag = useCallback((cm, i) => {
    setDrag({ crewId: cm.id, crew: cm, start: i, cur: i });
  }, [setDrag]);

  const extendDrag = useCallback((cm, i) => {
    const d = dragRef.current;
    if (!d || d.crewId !== cm.id) return;                // row-independent; no-op when idle
    setDrag({ ...d, cur: i });
  }, [setDrag]);

  const endDrag = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    setDrag(null);
    const lo = Math.min(d.start, d.cur);
    const hi = Math.max(d.start, d.cur);
    onPaint?.(d.crew, lo, hi);                           // ALWAYS paints (or erases)
  }, [setDrag, onPaint]);

  const cancelDrag = useCallback(() => {
    if (dragRef.current) setDrag(null);
  }, [setDrag]);

  const onCellKey = useCallback((cm, i) => { onPaint?.(cm, i, i); }, [onPaint]);
  const currentSlot = showNow ? nowSlot(now, gridStartHour) : null;
  const currentHour = showNow ? now.getHours() : -1;

  // Section split. currentStatus null → on-vessel (treat unknown as
  // active until we have reason otherwise).
  const onVessel = crew.filter(c => !OFF_VESSEL_STATUSES.has(c.currentStatus));
  const offVessel = crew.filter(c => OFF_VESSEL_STATUSES.has(c.currentStatus));

  const byDept = new Map();
  for (const c of onVessel) {
    const d = c.department || 'Other';
    if (!byDept.has(d)) byDept.set(d, []);
    byDept.get(d).push(c);
  }
  // Sort crew within each department (state rank → role rank → name), then
  // pin the signed-in user's own row to the top of their department so they
  // always see their own rota first, regardless of permission tier.
  for (const arr of byDept.values()) {
    arr.sort(sortWithinDept);
    if (user?.id) {
      const idx = arr.findIndex(c => c.userId === user.id);
      if (idx > 0) {
        const [mine] = arr.splice(idx, 1);
        arr.unshift(mine);
      }
    }
  }

  const orderedDepts = orderDepartments(
    byDept, onVessel, currentUser?.department_id || null,
  );

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
      <div
        className="rota-grid-inner"
        style={innerStyle}
        onPointerUp={editMode ? endDrag : undefined}
        onPointerLeave={editMode ? cancelDrag : undefined}
        onPointerCancel={editMode ? cancelDrag : undefined}
      >
        <HourHeader gridStartHour={gridStartHour} currentHour={currentHour} />
        {orderedDepts.map(dept => {
          const deptCrew = byDept.get(dept);
          const deptId = deptCrew[0]?.departmentId || null;
          return (
            <DepartmentSection
              key={dept}
              deptName={dept}
              crew={deptCrew}
              gridStartHour={gridStartHour}
              onCrewClick={onCrewClick}
              editMode={editMode && (!editableDeptIds || editableDeptIds.has(deptId))}
              onCellPointerDown={beginDrag}
              onCellPointerEnter={extendDrag}
              onCellKey={onCellKey}
              drag={drag}
              deptStatusRow={deptId && deptStatus ? deptStatus.get(deptId) : null}
              canSeeUnpublished={viewerTier === 'COMMAND' || (!!viewerDeptId && viewerDeptId === deptId)}
              highlightSlots={highlightSlots}
              viewDate={viewDate}
            />
          );
        })}
        <OffVesselSection
          crew={offVessel}
          gridStartHour={gridStartHour}
          onCrewClick={onCrewClick}
        />
        <TotalsRow crew={onVessel} gridStartHour={gridStartHour} />
        {nowLineStyle && <div className="rota-now-line" style={nowLineStyle} />}
      </div>
    </div>
  );
}

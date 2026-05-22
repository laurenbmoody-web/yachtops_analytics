import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, AlertTriangle, ChevronDown, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import DateRangePicker from './DateRangePicker';

// Phase 3a + 3b — Apply-template modal (simple + shift-pattern paths).
//
// Opens from a row-body click in the PatternPicker. Writes nothing on
// open; commits only on the explicit "Apply to rota" button after a
// conflict review (if any).
//
// SIMPLE path (3a, brief §4): name/scope/hours preview, date range via
// the always-visible calendar picker, collapsible crew checklist with
// inline selected names, conflict batch-summary, then a single batch
// write to rota_shifts.
//
// SHIFT PATTERN path (3b, brief §5): role-slot assignment via per-slot
// dropdowns filtered to crew with that job title; auto-match pre-selects
// the crew currently active per crew_status_history; date range via the
// same picker; pass-the-baton expansion across the range; preview
// matrix; mismatch warning (M ≠ N) that does NOT hard-block. Same
// conflict batch-summary as simple; same write path.
//
// Date handling: every date is a plain local 'YYYY-MM-DD' string.
// Local Date constructors / getFullYear/getMonth/getDate only.
// No toISOString in this file.

// ── Constants + utils ──────────────────────────────────────────────────────
const TYPE_COLOR = {
  duty: '#1C1B3A', watch: '#C65A1A', standby: '#B8935E',
  training: '#6B7F6B', medical: '#7A2E1E',
};
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WEEKDAY_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const pad = (n) => String(n).padStart(2, '0');

function toLocalDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fromStr(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function rangeDays(startStr, endStr) {
  if (!startStr || !endStr || startStr > endStr) return [];
  const start = fromStr(startStr);
  const end = fromStr(endStr);
  const out = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(toLocalDateStr(d));
  }
  return out;
}
function startOfThisWeekMondayStr() {
  const x = new Date();
  const w = x.getDay();
  const shift = w === 0 ? -6 : 1 - w;
  x.setDate(x.getDate() + shift);
  return toLocalDateStr(x);
}
function defaultRange() {
  const start = startOfThisWeekMondayStr();
  const [y, m, d] = start.split('-').map(Number);
  const endD = new Date(y, m - 1, d);
  endD.setDate(endD.getDate() + 6);
  return { start, end: toLocalDateStr(endD) };
}
function fmtTime(t) { return t ? String(t).slice(0, 5) : ''; }
function firstName(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }

// ── Crew-row inline-select (used by the pattern-apply role slots) ──────────
function CrewSelect({ value, candidates, onChange, placeholder, disabled }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!menuRef.current?.contains(e.target)
          && !triggerRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = candidates.find((c) => c.id === value) || null;
  const display = selected ? selected.name : (placeholder || '—');

  return (
    <div className={`cs-wrap${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="cs-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span className="cs-value">{display}</span>
        <ChevronDown size={12} className="cs-chev" />
      </button>
      {open && (
        <div ref={menuRef} className="cs-menu" role="listbox">
          {candidates.length === 0 && (
            <div className="cs-empty">No crew with this job title.</div>
          )}
          {candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={c.id === value}
              className={`cs-opt${c.id === value ? ' is-active' : ''}`}
              onClick={() => { onChange?.(c.id); setOpen(false); }}
            >
              <span className="cs-opt-name">{c.name}</span>
              {c.subtitle && <span className="cs-opt-sub">{c.subtitle}</span>}
            </button>
          ))}
          {value && (
            <button
              type="button"
              className="cs-opt cs-opt-clear"
              onClick={() => { onChange?.(null); setOpen(false); }}
            >Clear</button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Collapsible crew picker for simple-apply (Part C) ──────────────────────
function CrewCollapsible({ visibleCrew, ticked, setTicked, hodHint }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);

  const tickedList = visibleCrew.filter((c) => ticked.has(c.id));
  const inlineLabel = (() => {
    if (tickedList.length === 0) return 'No crew selected';
    if (tickedList.length <= 3) return tickedList.map((c) => firstName(c.name)).join(', ');
    const heads = tickedList.slice(0, 2).map((c) => firstName(c.name)).join(', ');
    return `${heads} +${tickedList.length - 2}`;
  })();

  const toggleAll = (on) => {
    if (on) setTicked(new Set(visibleCrew.map((c) => c.id)));
    else setTicked(new Set());
  };

  return (
    <div className="ap-crew-collapsible">
      <button
        ref={triggerRef}
        type="button"
        className={`ap-crew-trigger${open ? ' is-open' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ap-crew-inline">
          <span className="ap-crew-count">{tickedList.length}</span>
          <span className="ap-crew-names">{inlineLabel}</span>
        </span>
        <ChevronDown size={14} className="ap-crew-chev" />
      </button>
      {open && (
        <div className="ap-crew-expanded">
          <div className="ap-crew-actions-row">
            <button type="button" className="ap-linkbtn"
              onClick={() => toggleAll(true)}>Select all</button>
            <span className="tp-dot">·</span>
            <button type="button" className="ap-linkbtn"
              onClick={() => toggleAll(false)}>None</button>
          </div>
          {hodHint && <div className="ap-hod-hint">{hodHint}</div>}
          <div className="ap-crew-list">
            {visibleCrew.length === 0 && <div className="ap-empty">No eligible crew.</div>}
            {visibleCrew.map((c) => {
              const isOn = ticked.has(c.id);
              return (
                <label
                  key={c.id}
                  className={`te-dept-row${isOn ? ' is-selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isOn}
                    onChange={() => setTicked((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                      return next;
                    })}
                  />
                  <span className="ap-crew-name">{c.name}</span>
                  <span className="ap-crew-role">{c.role || ''}</span>
                  <span className="ap-crew-dept">{c.department || ''}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────
export default function ApplyTemplateModal({
  open, template, rota, trip, crew = [], currentUser, tier, myMemberId,
  applyTemplate, ensureDraft, onClose, onToast,
}) {
  const isPattern = template?.kind === 'rotation';
  const hodDeptId = tier === 'HOD' ? (currentUser?.department_id || null) : null;
  const visibleCrew = useMemo(() => {
    if (!hodDeptId) return crew;
    return crew.filter((c) => c.departmentId === hodDeptId);
  }, [crew, hodDeptId]);

  // ── Date range state — used by both paths. Default = This week. ────
  const [range, setRange] = useState(() => defaultRange());

  // ── Simple-apply state: who's ticked ───────────────────────────────
  const [ticked, setTicked] = useState(() => new Set());

  // ── Pattern-apply state: per-slot assignments [memberId | null] ────
  const [assignments, setAssignments] = useState([]);

  // ── Modal-phase state (shared) ─────────────────────────────────────
  const [phase, setPhase] = useState('select');  // 'select' | 'conflicts' | 'applying'
  const [conflicts, setConflicts] = useState(null);
  const [busy, setBusy] = useState(false);

  // ── Re-seed on open / template change ──────────────────────────────
  useEffect(() => {
    if (!open) return;
    setRange(defaultRange());
    setPhase('select');
    setConflicts(null);
    setBusy(false);

    if (template?.kind === 'rotation') {
      // Auto-match per slot — pre-pick the first candidate currently active.
      const slots = Array.isArray(template?.body?.roles) ? template.body.roles : [];
      const seeded = slots.map((slotTitle) => {
        const eligible = visibleCrew.filter((c) =>
          (c.role || '') === (slotTitle || '')
          && (c.currentStatus === 'active' || c.currentStatus == null),
        );
        return eligible[0]?.id || null;
      });
      setAssignments(seeded);
      setTicked(new Set());
    } else {
      let initialTicked;
      if (template?.scope === 'department' && template?.departmentId) {
        initialTicked = new Set(visibleCrew
          .filter((c) => c.departmentId === template.departmentId)
          .map((c) => c.id));
      } else {
        initialTicked = new Set();
      }
      setTicked(initialTicked);
      setAssignments([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template?.id]);

  // Default the start to the trip start when the rota is trip-owned,
  // and the end to the trip end — but only seed on open, never overwrite
  // the user's subsequent edits.
  useEffect(() => {
    if (!open) return;
    if (rota?.ownerType === 'trip' && trip?.dateStart && trip?.dateEnd) {
      setRange({ start: trip.dateStart, end: trip.dateEnd });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template?.id]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, busy]);

  // ── Derived ────────────────────────────────────────────────────────
  const dates = useMemo(() => rangeDays(range?.start, range?.end), [range]);

  // For simple apply
  const tickedMemberIds = Array.from(ticked);

  // For pattern apply
  const duties = useMemo(
    () => Array.isArray(template?.body?.duties) ? template.body.duties : [],
    [template],
  );
  const slotTitles = useMemo(
    () => Array.isArray(template?.body?.roles) ? template.body.roles : [],
    [template],
  );
  const candidatesPerSlot = useMemo(() => slotTitles.map((slotTitle) => {
    return visibleCrew
      .filter((c) => (c.role || '') === (slotTitle || ''))
      .map((c) => ({
        id: c.id,
        name: c.name,
        subtitle: c.department || '',
        active: c.currentStatus === 'active' || c.currentStatus == null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }), [slotTitles, visibleCrew]);

  // ── Pattern duty resolution: duty[(j - k + N) mod N] ───────────────
  const N = duties.length;
  const M = slotTitles.length;
  const cellDutyIndex = (j, k) => (j < N ? ((j - k + N) % N) : null);

  // ── Row builder ────────────────────────────────────────────────────
  const buildSimpleRow = (memberId, dateStr) => {
    const body = template.body || {};
    const row = {
      tenant_id: rota?.tenantId,
      rota_id: rota?.id,
      member_id: memberId,
      shift_date: dateStr,
      start_time: body.start_time || '00:00',
      end_time: body.end_time || '00:00',
      shift_type: body.shift_type || 'duty',
    };
    if (body.sub_type) row.sub_type = body.sub_type;
    if (rota?.ownerType === 'trip' && rota?.tripId) row.trip_id = rota.tripId;
    if (myMemberId) row.created_by = myMemberId;
    return row;
  };
  const buildPatternRow = (memberId, dateStr, duty) => {
    const row = {
      tenant_id: rota?.tenantId,
      rota_id: rota?.id,
      member_id: memberId,
      shift_date: dateStr,
      start_time: duty?.start_time || '00:00',
      end_time: duty?.end_time || '00:00',
      shift_type: duty?.shift_type || 'duty',
    };
    if (duty?.sub_type) row.sub_type = duty.sub_type;
    if (rota?.ownerType === 'trip' && rota?.tripId) row.trip_id = rota.tripId;
    if (myMemberId) row.created_by = myMemberId;
    return row;
  };

  // ── Build the full "what would be written" list ────────────────────
  const targetRowsAndMembers = useMemo(() => {
    if (!template || dates.length === 0) return { rows: [], memberIds: [] };
    const rows = [];
    const memberSet = new Set();
    if (isPattern) {
      for (let k = 0; k < dates.length; k += 1) {
        const dateStr = dates[k];
        for (let j = 0; j < assignments.length; j += 1) {
          const mid = assignments[j];
          if (!mid) continue;
          const di = cellDutyIndex(j, k);
          if (di == null) continue;
          rows.push(buildPatternRow(mid, dateStr, duties[di]));
          memberSet.add(mid);
        }
      }
    } else {
      for (const m of tickedMemberIds) {
        for (const d of dates) rows.push(buildSimpleRow(m, d));
        memberSet.add(m);
      }
    }
    return { rows, memberIds: Array.from(memberSet) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, dates, isPattern, assignments, ticked, duties]);

  if (!open || !template) return null;

  // ── Header detail (preview doubles as header) ──────────────────────
  const headerScope = template.scope === 'vessel'
    ? 'All departments'
    : (template.departmentName || 'Department');
  const headerEyebrow = isPattern ? 'Apply shift pattern' : 'Apply template';
  const headerSwatch = isPattern
    ? null
    : (TYPE_COLOR[template.body?.shift_type] || '#B4B2A9');
  const headerHours = !isPattern
    ? (template.body?.start_time && template.body?.end_time
        ? `${fmtTime(template.body.start_time)} – ${fmtTime(template.body.end_time)}`
        : '—')
    : null;

  // ── Apply (conflict check then commit) ─────────────────────────────
  const runConflictCheck = async () => {
    const { rows, memberIds } = targetRowsAndMembers;
    if (rows.length === 0) {
      onToast?.(isPattern
        ? 'Assign at least one crew member to a role and pick a date range.'
        : 'Pick at least one crew member to apply this template.');
      return;
    }
    setBusy(true);
    try {
      const { data, error: qErr } = await supabase
        .from('rota_shifts')
        .select('id, member_id, shift_date')
        .eq('tenant_id', rota.tenantId)
        .in('member_id', memberIds)
        .in('shift_date', dates);
      if (qErr) throw qErr;

      const targetKeys = new Set(rows.map((r) => `${r.member_id}|${r.shift_date}`));
      const conflictRows = (data || []).filter((r) =>
        targetKeys.has(`${r.member_id}|${r.shift_date}`),
      );

      if (conflictRows.length === 0) {
        await commit({ mode: 'skip', conflictKeys: new Set(), conflictIds: [] });
        return;
      }
      setConflicts({
        total: rows.length,
        clashes: conflictRows.length,
        conflictKeys: new Set(conflictRows.map((r) => `${r.member_id}|${r.shift_date}`)),
        conflictIds: conflictRows.map((r) => r.id),
      });
      setPhase('conflicts');
    } catch (e) {
      onToast?.(`Conflict check failed — ${e.message || 'try again'}`);
    } finally {
      setBusy(false);
    }
  };

  const commit = async ({ mode, conflictKeys, conflictIds }) => {
    setBusy(true);
    setPhase('applying');
    const allRows = targetRowsAndMembers.rows;
    const rows = mode === 'skip'
      ? allRows.filter((r) => !conflictKeys.has(`${r.member_id}|${r.shift_date}`))
      : allRows;
    const deleteIds = mode === 'overwrite' ? (conflictIds || []) : [];
    const res = await applyTemplate({ rows, deleteIds });
    if (!res.ok) {
      onToast?.(`Couldn’t apply — ${res.error || 'try again'}`);
      setBusy(false);
      setPhase(conflicts ? 'conflicts' : 'select');
      return;
    }

    // ensureDraft per affected department (already optimistic).
    const memberDeptMap = new Map(visibleCrew.map((c) => [c.id, c.departmentId]));
    const affectedDeptIds = new Set();
    for (const r of rows) {
      const did = memberDeptMap.get(r.member_id);
      if (did) affectedDeptIds.add(did);
    }
    for (const departmentId of affectedDeptIds) {
      // eslint-disable-next-line no-await-in-loop
      const er = await ensureDraft({
        departmentId, vesselId: rota.vesselId, tenantId: rota.tenantId,
      });
      if (!er.ok && er.reason === 'no-init') {
        onToast?.('Department status not initialized — ask a CHIEF or COMMAND to enable editing.');
      }
    }

    onToast?.(
      `Wrote ${res.inserted} draft shift${res.inserted === 1 ? '' : 's'}` +
      (res.deleted ? ` (overwrote ${res.deleted}).` : '.'),
    );
    onClose?.();
  };

  // ── Pattern preview matrix (roles × first N days, capped to range) ─
  const previewDayCount = Math.min(dates.length, Math.max(N, 1));
  const previewDates = dates.slice(0, previewDayCount);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <>
      <div className="rest-popover-backdrop" onClick={busy ? undefined : onClose} />
      <div
        className={`te-panel ap-panel${isPattern ? ' ap-panel-pattern' : ''}`}
        role="dialog" aria-modal="true"
        aria-label={`Apply ${template.name}`}
      >
        <div className="tp-header">
          <div>
            <div className="tp-eyebrow">{headerEyebrow}</div>
            <h2 className="tp-title">{template.name}</h2>
            <div className="ap-header-sub">
              {headerSwatch && (
                <span className="ap-header-swatch"
                  style={{ background: headerSwatch }} aria-hidden />
              )}
              {isPattern && (
                <span className="ap-pattern-mark" aria-hidden>
                  <RefreshCw size={11} />
                </span>
              )}
              <span>{headerScope}</span>
              {headerHours && (
                <>
                  <span className="tp-dot">·</span>
                  <span>{headerHours}</span>
                </>
              )}
              {isPattern && (
                <>
                  <span className="tp-dot">·</span>
                  <span>{N} {N === 1 ? 'duty' : 'duties'} · {M} role{M === 1 ? '' : 's'}</span>
                </>
              )}
            </div>
          </div>
          <button type="button" className="tp-close"
            aria-label="Close" onClick={busy ? undefined : onClose}><X size={16} /></button>
        </div>

        {phase !== 'conflicts' && (
          <div className="te-body ap-body">
            <div className="te-field">
              <span className="te-field-label">When</span>
              <DateRangePicker
                value={range}
                onChange={setRange}
                trip={rota?.ownerType === 'trip' ? trip : null}
              />
            </div>

            {/* SIMPLE — collapsible crew checklist */}
            {!isPattern && (
              <div className="te-field">
                <span className="te-field-label">Crew</span>
                <CrewCollapsible
                  visibleCrew={visibleCrew}
                  ticked={ticked}
                  setTicked={setTicked}
                  hodHint={hodDeptId ? 'HOD scope — only your department’s crew can be assigned.' : null}
                />
                <div className="ap-summary">
                  <strong>{ticked.size}</strong> crew × <strong>{dates.length}</strong> day{dates.length === 1 ? '' : 's'}
                  {' = '}<strong>{targetRowsAndMembers.rows.length}</strong> draft shift{targetRowsAndMembers.rows.length === 1 ? '' : 's'}
                </div>
              </div>
            )}

            {/* PATTERN — role-slot assignments + preview */}
            {isPattern && (
              <>
                <div className="te-field">
                  <span className="te-field-label">Role assignments</span>
                  {hodDeptId && (
                    <div className="ap-hod-hint">
                      HOD scope — only your department’s crew appear in the dropdowns.
                    </div>
                  )}
                  <div className="ap-slot-list">
                    {slotTitles.map((slotTitle, j) => {
                      const cands = candidatesPerSlot[j] || [];
                      const noMatch = cands.length === 0;
                      return (
                        <div key={`slot-${j}`} className="ap-slot-row">
                          <div className="ap-slot-title">
                            <span className="ap-slot-idx">Slot {j + 1}</span>
                            <span className="ap-slot-role">{slotTitle || <em>Untitled</em>}</span>
                          </div>
                          <CrewSelect
                            value={assignments[j] || null}
                            candidates={cands}
                            onChange={(id) => setAssignments((prev) => {
                              const next = [...prev];
                              while (next.length <= j) next.push(null);
                              next[j] = id;
                              return next;
                            })}
                            placeholder={noMatch ? '— no crew with this job title —' : 'Assign…'}
                            disabled={noMatch}
                          />
                          {noMatch && (
                            <div className="ap-slot-flag">
                              No active crew with this job title — assign someone or leave empty.
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {(M !== N) && (
                  <div className="ap-mismatch">
                    <AlertTriangle size={14} color="#7A2E1E" />
                    {M > N
                      ? <span>More roles ({M}) than duties ({N}) — slot{M - N === 1 ? '' : 's'} {Array.from({ length: M - N }, (_, i) => N + i + 1).join(', ')} have no duty in this cycle. They’ll be skipped on write. (Add a duty or drop the extra role to even up.)</span>
                      : <span>Fewer roles ({M}) than duties ({N}) — {N - M} dut{N - M === 1 ? 'y goes' : 'ies go'} uncovered each day. (Add a role or drop a duty to even up.)</span>
                    }
                  </div>
                )}

                {previewDayCount > 0 && (
                  <div className="te-field">
                    <span className="te-field-label">Preview (first {previewDayCount} day{previewDayCount === 1 ? '' : 's'})</span>
                    <div className="ap-preview-wrap">
                      <table className="ap-preview">
                        <thead>
                          <tr>
                            <th>Role / crew</th>
                            {previewDates.map((d, k) => {
                              const dt = fromStr(d);
                              return (
                                <th key={d} className="ap-preview-dh">
                                  <div>Day {k + 1}</div>
                                  <div className="ap-preview-date">{WEEKDAY_SHORT[dt.getDay()]} {dt.getDate()} {MONTH_SHORT[dt.getMonth()]}</div>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {slotTitles.map((slotTitle, j) => {
                            const assignedId = assignments[j] || null;
                            const assignedCrew = assignedId
                              ? visibleCrew.find((c) => c.id === assignedId)
                              : null;
                            return (
                              <tr key={`pr-${j}`}>
                                <td className="ap-preview-role">
                                  <div className="ap-preview-role-title">{slotTitle}</div>
                                  <div className="ap-preview-role-crew">
                                    {assignedCrew ? assignedCrew.name : <em>unassigned</em>}
                                  </div>
                                </td>
                                {previewDates.map((d, k) => {
                                  const di = cellDutyIndex(j, k);
                                  if (di == null) {
                                    return <td key={`c-${j}-${k}`} className="ap-preview-empty">—</td>;
                                  }
                                  const duty = duties[di];
                                  const c = TYPE_COLOR[duty?.shift_type] || '#B4B2A9';
                                  return (
                                    <td key={`c-${j}-${k}`} className="ap-preview-cell"
                                      style={{ background: c, color: '#F5F1EA' }}>
                                      <div className="ap-preview-cell-label">{duty?.label || 'Duty'}</div>
                                      <div className="ap-preview-cell-time">
                                        {fmtTime(duty?.start_time)}–{fmtTime(duty?.end_time)}
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="ap-summary">
                      <strong>{targetRowsAndMembers.rows.length}</strong> draft shift{targetRowsAndMembers.rows.length === 1 ? '' : 's'} across <strong>{dates.length}</strong> day{dates.length === 1 ? '' : 's'}.
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {phase === 'conflicts' && conflicts && (
          <div className="te-body ap-body">
            <div className="ap-conflict">
              <div className="ap-conflict-head">
                <AlertTriangle size={16} color="#7A2E1E" />
                <span>Existing shifts in this range</span>
              </div>
              <div className="ap-conflict-body">
                This will create <strong>{conflicts.total}</strong> shift{conflicts.total === 1 ? '' : 's'}.
                {' '}<strong>{conflicts.clashes}</strong> of them clash with an existing shift.
              </div>
              <div className="ap-conflict-help">Pick one rule for the whole batch:</div>
              <ul className="ap-conflict-options">
                <li><strong>Skip the clashing days</strong> — only write where the crew member is free; existing shifts stay.</li>
                <li><strong>Overwrite</strong> — replace the clashing shifts with this template (still as drafts).</li>
              </ul>
            </div>
          </div>
        )}

        <div className="te-footer">
          <span />
          <div className="te-footer-actions">
            {phase === 'select' && (
              <>
                <button type="button" className="v2-btn-ghost"
                  onClick={onClose} disabled={busy}>Cancel</button>
                <button type="button" className="v2-btn-filled"
                  onClick={runConflictCheck}
                  disabled={busy || targetRowsAndMembers.rows.length === 0}>
                  {busy ? 'Checking…' : 'Apply to rota'}
                </button>
              </>
            )}
            {phase === 'conflicts' && conflicts && (
              <>
                <button type="button" className="v2-btn-ghost"
                  onClick={() => setPhase('select')} disabled={busy}>Back</button>
                <button type="button" className="v2-btn-ghost"
                  onClick={() => commit({
                    mode: 'skip',
                    conflictKeys: conflicts.conflictKeys,
                    conflictIds: [],
                  })}
                  disabled={busy}>Skip conflicts</button>
                <button type="button" className="v2-btn-filled"
                  onClick={() => commit({
                    mode: 'overwrite',
                    conflictKeys: new Set(),
                    conflictIds: conflicts.conflictIds,
                  })}
                  disabled={busy}>Overwrite</button>
              </>
            )}
            {phase === 'applying' && (
              <button type="button" className="v2-btn-filled" disabled>Applying…</button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

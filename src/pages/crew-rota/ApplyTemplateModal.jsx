import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, AlertTriangle, ChevronDown, RefreshCw, Trash2, Plus, RotateCcw, CheckCircle2, Activity } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import DateRangePicker from './DateRangePicker';
import {
  assessApply,
  CIRCADIAN_SWING_THRESHOLD,
  CIRCADIAN_WINDOW_DAYS,
} from './restHours';

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

// "28 May" — from a plain 'YYYY-MM-DD' string. Local components only.
function fmtDateShort(dateStr) {
  if (!dateStr) return '';
  const d = fromStr(dateStr);
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

function fmtHoursH(decimal) {
  if (decimal == null || Number.isNaN(decimal)) return '—';
  const total = Math.max(0, Math.round(Number(decimal) * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// Honest one-liner per rule (used in the hard-warning list).
function formatMlcBreachPhrase(breach) {
  const { rule, projected, limit } = breach;
  if (rule === 'daily_rest_10h') {
    return `only ${fmtHoursH(projected)} rest — MLC minimum ${limit}h`;
  }
  if (rule === 'weekly_rest_77h') {
    return `${fmtHoursH(projected)} rolling 7-day rest — MLC minimum ${limit}h`;
  }
  if (rule === 'rest_period_split') {
    const pc = projected?.periodCount ?? '?';
    const longest = projected?.longest ?? 0;
    return `rest split into ${pc} period${pc === 1 ? '' : 's'}, longest ${fmtHoursH(longest)} — MLC requires ≤${limit?.maxPeriods} periods with one ≥${limit?.longestMin}h`;
  }
  if (rule === 'max_work_stretch_14h') {
    return `${fmtHoursH(projected)} continuous on-duty — MLC maximum ${limit}h`;
  }
  return `breach of ${rule}`;
}

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
  applyTemplate, ensureDraft, onClose, onApplied, onToast,
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

  // ── Pattern-apply WORK MODEL (in-memory, this-apply-only) ─────────
  // slots[] mirrors template.body.roles[] by position so the pass-the-
  // baton math (cellDutyIndex(j, k) using slot index j) still works
  // unchanged. The template row is NEVER mutated — drop / double / un-
  // drop affect this state only.
  //   { title, members: [memberId|null] (1 or 2), dropped: bool }
  const [slots, setSlots] = useState([]);

  // ── Modal-phase state (shared) ─────────────────────────────────────
  // 'conflicts' here is the combined review phase — it surfaces shift
  // conflicts AND MLC breaches AND circadian flags. Kept as the same
  // state value to minimise churn from earlier phases.
  const [phase, setPhase] = useState('select');  // 'select' | 'conflicts' | 'applying'
  const [conflicts, setConflicts] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [busy, setBusy] = useState(false);

  // ── Re-seed on open / template change ──────────────────────────────
  useEffect(() => {
    if (!open) return;
    setRange(defaultRange());
    setPhase('select');
    setConflicts(null);
    setAssessment(null);
    setOverrideReason('');
    setBusy(false);

    if (template?.kind === 'rotation') {
      // Auto-match per slot — pre-pick the first candidate currently active.
      // Each slot starts un-dropped with one member position.
      const titles = Array.isArray(template?.body?.roles) ? template.body.roles : [];
      const seeded = titles.map((title) => {
        const eligible = visibleCrew.find((c) =>
          (c.role || '') === (title || '')
          && (c.currentStatus === 'active' || c.currentStatus == null),
        );
        return { title, members: [eligible?.id || null], dropped: false, widen: false };
      });
      setSlots(seeded);
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
      setSlots([]);
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

  // Fallback pools for slots whose job title matches NO active crew
  // (placeholder labels like "Role 3", or a real title with no current
  // active holder). The dropdown is never dead — the user can pick from
  // the template's department crew (default), or widen to all vessel
  // crew. The subtitle in fallback shows the crew's REAL job title so
  // the user can tell who they're picking.
  const fallbackDept = useMemo(() => {
    if (template?.scope !== 'department' || !template?.departmentId) return null;
    return visibleCrew
      .filter((c) => c.departmentId === template.departmentId)
      .map((c) => ({
        id: c.id, name: c.name, subtitle: c.role || c.department || '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [template, visibleCrew]);
  const fallbackAll = useMemo(() => visibleCrew
    .map((c) => ({
      id: c.id, name: c.name, subtitle: c.role || c.department || '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name)),
  [visibleCrew]);

  // Returns { items, source: 'match' | 'dept' | 'all' } for a slot.
  const resolveSlotCandidates = (j) => {
    const matches = candidatesPerSlot[j] || [];
    if (matches.length > 0) return { items: matches, source: 'match' };
    const slot = slots[j];
    if (slot?.widen) return { items: fallbackAll, source: 'all' };
    if (fallbackDept) return { items: fallbackDept, source: 'dept' };
    return { items: fallbackAll, source: 'all' };
  };

  // ── Pattern duty resolution: duty[(j - k + N) mod N] ───────────────
  const N = duties.length;
  const M = slotTitles.length;                            // template-defined slot count
  const effectiveM = slots.filter((s) => !s.dropped).length;  // live, this-apply only
  const cellDutyIndex = (j, k) => (j < N ? ((j - k + N) % N) : null);

  // ── Slot mutators (in-memory, never touch the template) ────────────
  const dropSlot = (j) => setSlots((prev) =>
    prev.map((s, i) => (i === j ? { ...s, dropped: true } : s)));
  const restoreSlot = (j) => setSlots((prev) =>
    prev.map((s, i) => (i === j ? { ...s, dropped: false } : s)));
  const setSlotMember = (j, mIdx, memberId) => setSlots((prev) =>
    prev.map((s, i) => {
      if (i !== j) return s;
      const members = [...s.members];
      while (members.length <= mIdx) members.push(null);
      members[mIdx] = memberId;
      return { ...s, members };
    }));
  const addDouble = (j) => setSlots((prev) =>
    prev.map((s, i) => (i === j && s.members.length < 2
      ? { ...s, members: [...s.members, null] }
      : s)));
  const removeDouble = (j) => setSlots((prev) =>
    prev.map((s, i) => (i === j
      ? { ...s, members: s.members.slice(0, 1) }
      : s)));
  // Widen toggle for no-match / placeholder slots. When narrowing back to
  // the template's department, any previously-picked crew member who isn't
  // in that department is cleared from the slot so the dropdown trigger
  // doesn't silently show a placeholder while the assignment quietly
  // persists. The opposite direction (widen on) keeps all picks.
  const toggleWiden = (j) => setSlots((prev) => prev.map((s, i) => {
    if (i !== j) return s;
    const nextWiden = !s.widen;
    if (!nextWiden && template?.scope === 'department' && template?.departmentId) {
      const eligible = new Set(visibleCrew
        .filter((c) => c.departmentId === template.departmentId)
        .map((c) => c.id));
      return {
        ...s,
        widen: false,
        members: s.members.map((mid) => (mid && eligible.has(mid) ? mid : null)),
      };
    }
    return { ...s, widen: nextWiden };
  }));

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
        for (let j = 0; j < slots.length; j += 1) {
          const slot = slots[j];
          if (slot.dropped) continue;
          const di = cellDutyIndex(j, k);
          if (di == null) continue;
          for (const memberId of slot.members) {
            if (!memberId) continue;
            rows.push(buildPatternRow(memberId, dateStr, duties[di]));
            memberSet.add(memberId);
          }
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
  }, [template, dates, isPattern, slots, ticked, duties]);

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

  // ── Apply (conflict + MLC/circadian check then commit) ─────────────
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
      // 1 — same-day conflicts (existing behaviour).
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

      // 2 — 7-day-back history window for MLC + circadian assessment.
      // Local date components only — no UTC conversion.
      const earliest = dates[0];
      const latest = dates[dates.length - 1];
      const [ey, em, ed] = earliest.split('-').map(Number);
      const histStart = new Date(ey, em - 1, ed);
      histStart.setDate(histStart.getDate() - 6);
      const histStartStr = `${histStart.getFullYear()}-${pad(histStart.getMonth() + 1)}-${pad(histStart.getDate())}`;

      const { data: histData, error: hErr } = await supabase
        .from('rota_shifts')
        .select('member_id, shift_date, start_time, end_time, shift_type, sub_type')
        .eq('tenant_id', rota.tenantId)
        .in('member_id', memberIds)
        .gte('shift_date', histStartStr)
        .lte('shift_date', latest);
      if (hErr) throw hErr;

      const nextAssessment = assessApply({
        memberIds,
        dates,
        proposedRows: rows,
        existingWindowShifts: histData || [],
      });

      const nextConflicts = conflictRows.length > 0
        ? {
            total: rows.length,
            clashes: conflictRows.length,
            conflictKeys: new Set(conflictRows.map((r) => `${r.member_id}|${r.shift_date}`)),
            conflictIds: conflictRows.map((r) => r.id),
          }
        : null;

      // Nothing to review → commit straight through.
      if (!nextConflicts && !nextAssessment.hasMlc && !nextAssessment.hasCircadian) {
        setAssessment(null);
        await commit({ mode: 'skip', conflictKeys: new Set(), conflictIds: [], assessmentOverride: null });
        return;
      }
      setConflicts(nextConflicts);
      setAssessment(nextAssessment);
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

    // ── MLC override audit ─────────────────────────────────────────
    // One rota_approval_events row per affected department, scoped to
    // that department's crew. context.shift_ids is the set of inserted
    // shifts in that department; context.breaches is the per-rule list.
    // RLS requires actor_id = auth.uid(), so we fetch the session user.
    if (assessment?.hasMlc && overrideReason.trim()) {
      try {
        const { data: authData } = await supabase.auth.getUser();
        const actorId = authData?.user?.id;
        if (actorId) {
          const insertedIds = res.insertedIds || [];
          const idsByDept = new Map();
          for (let i = 0; i < rows.length; i += 1) {
            const did = memberDeptMap.get(rows[i].member_id);
            if (!did) continue;
            const id = insertedIds[i];
            if (!id) continue;
            if (!idsByDept.has(did)) idsByDept.set(did, []);
            idsByDept.get(did).push(id);
          }
          const breachesByDept = new Map();
          const memberNameMap = new Map(visibleCrew.map((c) => [c.id, c.name]));
          for (const [memberId, info] of Object.entries(assessment.byMember)) {
            if (!info.mlcBreaches || info.mlcBreaches.length === 0) continue;
            const did = memberDeptMap.get(memberId);
            if (!did) continue;
            if (!breachesByDept.has(did)) breachesByDept.set(did, []);
            for (const b of info.mlcBreaches) {
              breachesByDept.get(did).push({
                member_id: memberId,
                member: memberNameMap.get(memberId) || '',
                date: b.date,
                rule: b.rule,
                projected: b.projected,
                limit: b.limit,
              });
            }
          }
          const eventRows = [];
          for (const [departmentId, breaches] of breachesByDept) {
            eventRows.push({
              rota_id: rota.id,
              department_id: departmentId,
              tenant_id: rota.tenantId,
              vessel_id: rota.vesselId,
              event_type: 'mlc_override',
              actor_id: actorId,
              actor_tier: tier,
              note: overrideReason.trim(),
              context: { shift_ids: idsByDept.get(departmentId) || [], breaches },
            });
          }
          if (eventRows.length > 0) {
            const { error: evErr } = await supabase
              .from('rota_approval_events').insert(eventRows);
            if (evErr) console.warn('mlc_override event insert failed:', evErr.message);
          }
        }
      } catch (e) {
        // Audit failure must not block the apply — log and move on.
        console.warn('mlc_override audit threw:', e);
      }
    }

    onToast?.(
      `Wrote ${res.inserted} draft shift${res.inserted === 1 ? '' : 's'}` +
      (res.deleted ? ` (overwrote ${res.deleted}).` : '.'),
    );
    // Successful apply → return the user to the rota grid (close BOTH the
    // apply modal and the picker). Cancel/X/Esc paths still use onClose,
    // which the page wires to "back to picker" — the distinction lives at
    // the call site, not here.
    (onApplied || onClose)?.();
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
                  <span>
                    {N} {N === 1 ? 'duty' : 'duties'} · {effectiveM}
                    {effectiveM !== slots.length ? ` of ${slots.length}` : ''}
                    {' '}slot{effectiveM === 1 ? '' : 's'}
                  </span>
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
                    {slots.map((slot, j) => {
                      if (slot.dropped) {
                        return (
                          <div key={`slot-${j}`} className="ap-slot-row is-dropped">
                            <div className="ap-slot-title">
                              <span className="ap-slot-idx">Slot {j + 1}</span>
                              <span className="ap-slot-role ap-slot-role-dropped">
                                {slot.title || <em>Untitled</em>}
                              </span>
                            </div>
                            <div className="ap-slot-dropped-note">
                              Dropped from this apply.
                            </div>
                            <button
                              type="button"
                              className="ap-slot-action"
                              onClick={() => restoreSlot(j)}
                              aria-label={`Restore slot ${j + 1}`}
                            ><RotateCcw size={12} /> Restore</button>
                          </div>
                        );
                      }
                      const m1 = slot.members[0] || null;
                      const m2 = slot.members[1] || null;
                      const resolved = resolveSlotCandidates(j);
                      const effCands = resolved.items;
                      const isFallback = resolved.source !== 'match';
                      // Second-position candidates: filter out the first pick.
                      const candsForSecond = effCands.filter((c) => c.id !== m1);
                      const noUsable = effCands.length === 0;
                      const deptName = template?.departmentName || 'the department';
                      return (
                        <div key={`slot-${j}`} className="ap-slot-row">
                          <div className="ap-slot-title">
                            <span className="ap-slot-idx">Slot {j + 1}</span>
                            <span className="ap-slot-role">{slot.title || <em>Untitled</em>}</span>
                          </div>
                          <div className="ap-slot-controls">
                            <CrewSelect
                              value={m1}
                              candidates={effCands}
                              onChange={(id) => setSlotMember(j, 0, id)}
                              placeholder={noUsable ? '— no crew available —' : 'Assign…'}
                              disabled={noUsable}
                            />
                            {slot.members.length === 2 && (
                              <div className="ap-slot-double-row">
                                <CrewSelect
                                  value={m2}
                                  candidates={candsForSecond}
                                  onChange={(id) => setSlotMember(j, 1, id)}
                                  placeholder="Assign second crew…"
                                  disabled={candsForSecond.length === 0}
                                />
                                <button
                                  type="button"
                                  className="ap-slot-inline-btn"
                                  onClick={() => removeDouble(j)}
                                  aria-label={`Remove second crew from slot ${j + 1}`}
                                  title="Remove second crew"
                                ><X size={12} /></button>
                              </div>
                            )}
                            {isFallback && (
                              <div className="ap-slot-fallback">
                                <span>
                                  No exact job-title match — showing{' '}
                                  {resolved.source === 'dept' ? `${deptName} crew` : 'all vessel crew'}.
                                </span>
                                {fallbackDept && (
                                  <button
                                    type="button"
                                    className="ap-slot-action ap-slot-action-widen"
                                    onClick={() => toggleWiden(j)}
                                  >{slot.widen
                                    ? `Just ${deptName} crew`
                                    : 'Show all vessel crew'}</button>
                                )}
                              </div>
                            )}
                            <div className="ap-slot-foot">
                              {slot.members.length < 2 && !noUsable && (
                                <button
                                  type="button"
                                  className="ap-slot-action"
                                  onClick={() => addDouble(j)}
                                ><Plus size={12} /> Add another crew to this slot</button>
                              )}
                              <button
                                type="button"
                                className="ap-slot-action ap-slot-action-drop"
                                onClick={() => dropSlot(j)}
                                aria-label={`Drop slot ${j + 1} from this apply`}
                              ><Trash2 size={12} /> Drop slot</button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Live mismatch banner. effectiveM = live, non-dropped slot
                    count (this-apply only). The template's M/N are unchanged. */}
                {effectiveM === N && N > 0 && (slots.length !== N || slots.some((s) => s.dropped)) && (
                  <div className="ap-mismatch ap-mismatch-ok">
                    <CheckCircle2 size={14} color="#2D5A3A" />
                    <span>Evened up: {N} active slot{N === 1 ? '' : 's'} matching {N} dut{N === 1 ? 'y' : 'ies'} this apply.</span>
                  </div>
                )}
                {effectiveM > N && (
                  <div className="ap-mismatch">
                    <AlertTriangle size={14} color="#7A2E1E" />
                    <span>
                      More active slots ({effectiveM}) than duties ({N}) — {effectiveM - N} over-rolled this cycle.
                      Use <strong>Drop slot</strong> above to remove a slot from this apply, or apply as-is
                      (over-rolled slots produce no rows).
                    </span>
                  </div>
                )}
                {effectiveM < N && effectiveM > 0 && (
                  <div className="ap-mismatch">
                    <AlertTriangle size={14} color="#7A2E1E" />
                    <span>
                      This pattern has more duties ({N}) than active slots ({effectiveM}) — {N - effectiveM} dut{N - effectiveM === 1 ? 'y goes' : 'ies go'} uncovered each day.
                      To add a duty, <strong>edit the shift pattern</strong> (apply doesn't change the template).
                    </span>
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
                          {(() => {
                            // Flatten to one preview row per (non-dropped slot,
                            // member position). Doubled slots appear twice;
                            // dropped slots are skipped entirely (per spec).
                            const previewRows = [];
                            slots.forEach((s, j) => {
                              if (s.dropped) return;
                              s.members.forEach((mid, i) => {
                                previewRows.push({ slotIdx: j, memberIdx: i, memberId: mid, title: s.title });
                              });
                            });
                            return previewRows.map((pr) => {
                              const assignedCrew = pr.memberId
                                ? visibleCrew.find((c) => c.id === pr.memberId)
                                : null;
                              return (
                                <tr key={`pr-${pr.slotIdx}-${pr.memberIdx}`}>
                                  <td className="ap-preview-role">
                                    <div className="ap-preview-role-title">
                                      {pr.title}
                                      {pr.memberIdx > 0 && (
                                        <span className="ap-preview-double-tag">2nd</span>
                                      )}
                                    </div>
                                    <div className="ap-preview-role-crew">
                                      {assignedCrew ? assignedCrew.name : <em>unassigned</em>}
                                    </div>
                                  </td>
                                  {previewDates.map((d, k) => {
                                    const di = cellDutyIndex(pr.slotIdx, k);
                                    if (di == null) {
                                      return <td key={`c-${pr.slotIdx}-${pr.memberIdx}-${k}`} className="ap-preview-empty">—</td>;
                                    }
                                    const duty = duties[di];
                                    const c = TYPE_COLOR[duty?.shift_type] || '#B4B2A9';
                                    return (
                                      <td key={`c-${pr.slotIdx}-${pr.memberIdx}-${k}`} className="ap-preview-cell"
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
                            });
                          })()}
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

        {phase === 'conflicts' && (
          <div className="te-body ap-body">
            {conflicts && (
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
            )}

            {assessment?.hasMlc && (
              <div className="ap-mlc-hard">
                <div className="ap-mlc-head">
                  <AlertTriangle size={16} color="#7A2E1E" />
                  <span>MLC rest-hour breaches</span>
                </div>
                <div className="ap-mlc-body">
                  This apply would create the following MLC rest-hour breaches:
                </div>
                <ul className="ap-mlc-list">
                  {Object.entries(assessment.byMember).flatMap(([memberId, info]) => {
                    const c = visibleCrew.find((x) => x.id === memberId);
                    const name = c?.name || 'Unknown';
                    return info.mlcBreaches.map((b, i) => (
                      <li key={`mlc-${memberId}-${i}`}>
                        <strong>{name}</strong> — {formatMlcBreachPhrase(b)} on{' '}
                        <strong>{fmtDateShort(b.date)}</strong>.
                      </li>
                    ));
                  })}
                </ul>
                <label className="ap-override-label">
                  <span>Reason for override <em>(required to proceed)</em></span>
                  <textarea
                    className="ap-override-reason"
                    rows={2}
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="e.g. departure window — crew rotates off in two days"
                  />
                </label>
              </div>
            )}

            {assessment?.hasCircadian && (
              <div className="ap-circadian-soft">
                <div className="ap-circadian-head">
                  <Activity size={14} />
                  <span>Circadian rhythm — schedule swings</span>
                </div>
                <div className="ap-circadian-body">
                  Heads-up: ≥{CIRCADIAN_SWING_THRESHOLD} schedule swings in {CIRCADIAN_WINDOW_DAYS} days for these crew. Soft flag — doesn’t block apply.
                </div>
                <ul className="ap-circadian-list">
                  {Object.entries(assessment.byMember).flatMap(([memberId, info]) => {
                    if (!info.circadianFlags || info.circadianFlags.length === 0) return [];
                    const c = visibleCrew.find((x) => x.id === memberId);
                    const name = c?.name || 'Unknown';
                    return info.circadianFlags.map((f, i) => (
                      <li key={`circ-${memberId}-${i}`}>
                        <strong>{name}</strong> — {f.count} schedule swings in the past {CIRCADIAN_WINDOW_DAYS} days.
                      </li>
                    ));
                  })}
                </ul>
              </div>
            )}
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
            {phase === 'conflicts' && (() => {
              const needsReason = !!assessment?.hasMlc;
              const reasonOk = !needsReason || overrideReason.trim().length > 0;
              const blocked = busy || !reasonOk;
              const applyLabel = needsReason ? 'Override + apply' : 'Apply';
              const skipLabel = needsReason ? 'Override + skip conflicts' : 'Skip conflicts';
              const overwriteLabel = needsReason ? 'Override + overwrite' : 'Overwrite';
              return (
                <>
                  <button type="button" className="v2-btn-ghost"
                    onClick={() => setPhase('select')} disabled={busy}>Back</button>
                  {conflicts ? (
                    <>
                      <button type="button" className="v2-btn-ghost"
                        onClick={() => commit({
                          mode: 'skip',
                          conflictKeys: conflicts.conflictKeys,
                          conflictIds: [],
                        })}
                        disabled={blocked}>{skipLabel}</button>
                      <button type="button" className="v2-btn-filled"
                        onClick={() => commit({
                          mode: 'overwrite',
                          conflictKeys: new Set(),
                          conflictIds: conflicts.conflictIds,
                        })}
                        disabled={blocked}>{overwriteLabel}</button>
                    </>
                  ) : (
                    <button type="button" className="v2-btn-filled"
                      onClick={() => commit({
                        mode: 'skip',
                        conflictKeys: new Set(),
                        conflictIds: [],
                      })}
                      disabled={blocked}>{applyLabel}</button>
                  )}
                </>
              );
            })()}
            {phase === 'applying' && (
              <button type="button" className="v2-btn-filled" disabled>Applying…</button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

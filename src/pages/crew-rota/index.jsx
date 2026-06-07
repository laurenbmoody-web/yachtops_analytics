import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Calendar as CalendarIcon } from 'lucide-react';
import MonthPicker from './MonthPicker';
import Header from '../../components/navigation/Header';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import '../pantry/pantry.css';
import './crew-rota.css';
import RotaTodayGrid from '../trip-detail-view-with-guest-allocation/components/RotaTodayGrid';
import { DEPT_ORDER } from '../trip-detail-view-with-guest-allocation/sections/SectionCrew';
import CrewListView from './CrewListView';
import CrewWeekMatrix, { weekRangeLabel, weekRangeLabelLong } from './CrewWeekMatrix';
import RestPanelPopover from './RestPanelPopover';
import PatternPicker from './PatternPicker';
import SimpleTemplateEditor from './SimpleTemplateEditor';
import RotationTemplateEditor from './RotationTemplateEditor';
import ApplyTemplateModal from './ApplyTemplateModal';
import { useRotaShifts } from './useRotaShifts';
import { useRotaTemplates } from './useRotaTemplates';
import { useCurrentRota } from './useCurrentRota';
import { useRotaDepartmentStatus } from './useRotaDepartmentStatus';
import { usePendingReviewCount } from './usePendingReviewCount';
import {
  submitRotaDepartment,
  publishRotaDepartmentDirect,
} from './useRotaLifecycleWriters';
import {
  hasChiefForDepartment,
  getDraftShiftCount,
} from './rotaLifecycleChecks';

const EDITORIAL_BG = '#F5F1EA';
const GRID_START_HOUR = 6;
// Brush pills. "Off" is no longer a shift type — an empty cell IS the off
// state (absence of a working shift). Erase removes the working shift,
// which is how you "set someone to off."
const SHIFT_TYPE_PILLS = [
  ['duty', 'Duty'], ['watch', 'Watch'], ['standby', 'Standby'],
  ['training', 'Training'], ['medical', 'Medical'],
  ['erase', 'Erase'],
];
// Last paintable slot index (pre-midnight, given a 06:00 grid start).
const LAST_PRE_MIDNIGHT_SLOT = (24 - GRID_START_HOUR) * 2 - 1; // 35

function fullDateLabel(d) {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

// Local YYYY-MM-DD helpers — strictly local components (no UTC). Used to
// drive the stepper without timezone surprises.
function localTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseLocalDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addLocalDays(s, delta) {
  const d = parseLocalDate(s);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// (slot ↔ decimal helpers and shift-range math are now owned by
// useRotaShifts.applyPaint — the page only deals in slot indices.)

function RotaLegend({ now }) {
  const hhmmNow = now
    ? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    : '';
  return (
    <div className="crew-rota-legend">
      <div className="crew-rota-legend-item">
        <span className="crew-rota-legend-swatch" style={{ background: '#1C1B3A' }} />
        <span>Scheduled</span>
      </div>
      <div className="crew-rota-legend-item">
        <span className="crew-rota-legend-swatch" style={{ background: '#F7F5F0' }} />
        <span>Off</span>
      </div>
      <div className="crew-rota-legend-item">
        <span className="crew-rota-legend-swatch" style={{ background: '#EDEAE3' }} />
        <span>Saturday</span>
      </div>
      {now && (
        <div className="crew-rota-legend-item">
          <span style={{ width: 1.5, height: 14, background: '#C65A1A', opacity: 0.5, borderRadius: 1 }} />
          <span>Now ({hhmmNow})</span>
        </div>
      )}
      <div className="crew-rota-legend-item">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
          stroke="#C65A1A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span>Below 10h MLC</span>
      </div>
    </div>
  );
}

// Tier-conditional footer CTA. Wired to Phase-2 lifecycle writers.
// Scope: targets a single department (targetDeptId).
//   HOD    → their own dept (currentUser.department_id).
//   CHIEF  → their own dept (Phase 3 single-dept scope; multi-dept via
//            the Phase-4 inbox).
//   COMMAND → their own dept if populated; otherwise publish button is
//            disabled with a hint pointing to the inbox.
function EditFooterCTA({
  tier, draftDayCount, targetDeptId, targetDeptName,
  busy, onSubmit, onPublish,
}) {
  const n = draftDayCount;
  // Label counts DAYS with at least one draft (sub-commit 4 interpretation
  // (b)) — "Submit for approval (5 days)" reads as the workload preview
  // a reviewer actually cares about. The prior aggregate-shift count
  // ("47 drafts") overemphasised shift cardinality.
  const dayLabel = `${n} ${n === 1 ? 'day' : 'days'}`;
  const pubLabel = busy === 'publish' ? 'Publishing…' : `Publish (${dayLabel})`;
  const subLabel = busy === 'submit' ? 'Submitting…' : `Submit for approval (${dayLabel})`;
  const noTargetDept = !targetDeptId;
  const noTargetTitle = noTargetDept ? 'Use the review inbox to publish departments individually.' : undefined;
  return (
    <div className="crew-rota-cta">
      {tier === 'COMMAND' && (
        <button
          type="button"
          className="v2-btn-filled"
          onClick={onPublish}
          disabled={!!busy || n === 0 || noTargetDept}
          title={noTargetTitle}
          aria-label={`Publish ${targetDeptName || 'department'}`}
        >{pubLabel}</button>
      )}
      {tier === 'CHIEF' && (
        <>
          <button
            type="button"
            className="v2-btn-ghost"
            onClick={onSubmit}
            disabled={!!busy || n === 0 || noTargetDept}
            title={noTargetTitle}
            aria-label={`Submit ${targetDeptName || 'department'} for approval`}
          >{subLabel}</button>
          <button
            type="button"
            className="v2-btn-filled"
            onClick={onPublish}
            disabled={!!busy || n === 0 || noTargetDept}
            title={noTargetTitle}
            aria-label={`Publish ${targetDeptName || 'department'}`}
          >{pubLabel}</button>
        </>
      )}
      {tier === 'HOD' && (
        <button
          type="button"
          className="v2-btn-filled"
          onClick={onSubmit}
          disabled={!!busy || n === 0 || noTargetDept}
          aria-label={`Submit ${targetDeptName || 'department'} for approval`}
        >{subLabel}</button>
      )}
      {!['COMMAND', 'CHIEF', 'HOD'].includes(tier) && (
        <span style={{ fontStyle: 'italic' }}>Read-only — your role can’t publish drafts.</span>
      )}
    </div>
  );
}

export default function CrewRotaPage() {
  const navigate = useNavigate();
  const now = new Date();
  const realToday = localTodayStr();
  const { user, currentUser, tenantRole, activeTenantId } = useAuth();
  const [view, setView] = useState('grid');      // 'grid' | 'list' | 'week'
  // selectedDate (YYYY-MM-DD, local components) anchors the entire page —
  // rest figures, MLC warnings and the 7-day rolling window in
  // useRotaShifts all move with it. Defaults to real today.
  const [selectedDate, setSelectedDate] = useState(realToday);
  const isToday = selectedDate === realToday;
  const selectedDateObj = parseLocalDate(selectedDate);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [selectedCrew, setSelectedCrew] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [shiftType, setShiftType] = useState('duty'); // active type for new shifts
  const [pickerOpen, setPickerOpen] = useState(false);
  // editor: null | { kind: 'simple'|'rotation', template: object|null }
  const [editor, setEditor] = useState(null);
  // applyTarget: the template a user clicked to apply (3a). null = closed.
  const [applyTarget, setApplyTarget] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const tier = String(user?.permission_tier || tenantRole || '').toUpperCase();

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = EDITORIAL_BG;
    return () => { document.body.style.background = prev; };
  }, []);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // showToast(msg) — regular. showToast(msg, { error:true }) — destructive
  // styling for write-failure feedback. State is { msg, error } so the
  // renderer can apply the variant class; existing call sites pass a bare
  // string and stay backward-compat.
  const showToast = useCallback((msg, opts) => {
    setToast({ msg, error: !!opts?.error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  const {
    crew, shifts, windowShifts, loading, error, effectiveDate, draftCount,
    applyPaint, applyTemplate, refetch,
  } = useRotaShifts(
    selectedDate,
    // Day view: trailing 7. Week view: 6 days BEFORE selectedDate (so the
    // leftmost forward cell has its own trailing-7 MLC context) + 6 days
    // FORWARD of selectedDate (so the matrix has its 7 cells to display).
    view === 'week' ? { historyDays: 6, forwardDays: 6 } : { historyDays: 6, forwardDays: 0 },
  );
  const hasNoShifts = !loading && !error && shifts.length === 0;
  const { rota } = useCurrentRota();
  const { statusByDept, ensureDraft } = useRotaDepartmentStatus(rota?.id);
  const { count: pendingReviewCount } = usePendingReviewCount(rota?.id);
  // Notice only renders for reviewers (CHIEF / COMMAND) with non-zero
  // count. The hook returns 0 when no rota id yet, so the boolean is
  // safe to evaluate before rota resolves.
  const showPendingReviewNotice =
    pendingReviewCount > 0 && (tier === 'CHIEF' || tier === 'COMMAND');

  // Footer dept context — single-dept scope for Phase 3. HOD/CHIEF use
  // their own dept; COMMAND uses theirs if populated, otherwise the
  // publish button disables with a hint pointing to the inbox.
  const targetDeptId = currentUser?.department_id || null;
  // ctaBusy: null | 'submit' | 'publish' — disables both buttons during
  // the in-flight RPC so a double-click can't double-write.
  const [ctaBusy, setCtaBusy] = useState(null);

  // Per-dept day count for the footer label and disable check. Counts
  // DISTINCT shift_date values among draft shifts belonging to crew in
  // targetDeptId, sliced from the same windowShifts the page already
  // has loaded. Reactive — every optimistic paint / template apply
  // updates this in the same render the change lands.
  //
  // Trade-off: the count only includes drafts in the LOADED window
  // (trailing 7 days in day view, 13 days centred on selectedDate in
  // week view). Drafts on dates outside the window aren't counted.
  // For typical use — HOD editing the upcoming week — this is accurate.
  // For long-tail edits (drafts spread over months), Phase 6 polish
  // could replace this with a dedicated fetch + refresh.
  const draftDayCount = useMemo(() => {
    if (!targetDeptId) return 0;
    const deptMemberIds = new Set(
      crew.filter((c) => c.departmentId === targetDeptId).map((c) => c.id),
    );
    const days = new Set();
    for (const s of (windowShifts || [])) {
      if (s.status === 'draft' && deptMemberIds.has(s.memberId)) {
        days.add(s.date);
      }
    }
    return days.size;
  }, [targetDeptId, windowShifts, crew]);
  const {
    templates, loading: templatesLoading, error: templatesError,
    toggleStar, createTemplate, updateTemplate, deleteTemplate,
  } = useRotaTemplates();

  // Departments for the template editors. Fetched via get_tenant_departments,
  // then INTERSECTED with vessels.departments_in_use so the list shows only
  // the departments this tenant actually uses (5 for the test tenant, not
  // the 11-row global table). The RPC's p_tenant_id is a membership gate,
  // not a real scope filter (TODO(backlog) on migration 20260430110100);
  // until that lands at the schema level, intersect client-side.
  const [departments, setDepartments] = useState([]);
  useEffect(() => {
    if (!activeTenantId) { setDepartments([]); return; }
    let alive = true;
    (async () => {
      const [veRes, dpRes] = await Promise.all([
        supabase.from('vessels')
          .select('departments_in_use').eq('tenant_id', activeTenantId).maybeSingle(),
        supabase.rpc('get_tenant_departments', { p_tenant_id: activeTenantId }),
      ]);
      if (!alive) return;
      if (dpRes.error) {
        console.error('[crew-rota] get_tenant_departments error:', dpRes.error);
        setDepartments([]);
        return;
      }
      const all = (dpRes.data || []).map((d) => ({ id: d.id, name: d.name }));
      const inUse = Array.isArray(veRes.data?.departments_in_use)
        ? veRes.data.departments_in_use
        : null;
      // If departments_in_use is populated, filter strictly; otherwise fall
      // back to the full RPC list (covers any tenant that hasn't migrated
      // to the uuid[] column yet, so the picker never goes empty).
      let list = all;
      if (inUse && inUse.length > 0) {
        const set = new Set(inUse);
        list = all.filter((d) => set.has(d.id));
      }
      list.sort((a, b) => a.name.localeCompare(b.name));
      setDepartments(list);
    })();
    return () => { alive = false; };
  }, [activeTenantId]);

  const total = crew.length;
  // "On duty now" is a real-time fact. When the chief is viewing a non-
  // today date, useRotaShifts already zeros onNow on every crew row, but
  // we also drop the count from the headline copy — "0 on duty now"
  // displayed against e.g. yesterday's roster would be confusing.
  const onDuty = crew.filter(c => c.onNow && !c.offToday).length;
  const meta = view === 'week'
    ? `Week of ${weekRangeLabel(selectedDate)} · ${total} crew on this trip`
    : isToday
      ? `${fullDateLabel(selectedDateObj)} · ${total} crew on this trip · ${onDuty} on duty now`
      : `${fullDateLabel(selectedDateObj)} · ${total} crew on this trip`;

  const presentDepts = DEPT_ORDER.filter(d => crew.some(c => c.department === d));
  const cardContext = isToday
    ? `${presentDepts.join(' · ')}  —  ${total} crew · ${onDuty} on duty`
    : `${presentDepts.join(' · ')}  —  ${total} crew`;

  // The acting user's own tenant_members.id — rota_shifts.created_by FKs
  // tenant_members(id), so stamp it on inserts when resolvable.
  const myMemberId = crew.find(c => c.userId === user?.id)?.id || null;

  // After any shift write, mark the affected department's status row as
  // draft (creating it for COMMAND/CHIEF; graceful toast for HOD if none).
  const syncDeptDraft = useCallback(async (crewMember) => {
    if (!crewMember?.departmentId) {
      showToast('No department on this crew member — draft saved, but state not tracked.');
      return;
    }
    if (!rota?.id) return;
    const res = await ensureDraft({
      departmentId: crewMember.departmentId,
      vesselId: rota.vesselId,
      tenantId: activeTenantId,
    });
    if (!res.ok && res.reason === 'no-init') {
      showToast('Department status not initialized — ask a CHIEF or COMMAND to enable editing.');
    } else if (!res.ok && res.reason === 'error') {
      showToast(`Couldn’t update department state: ${res.detail || 'unknown error'}`);
    }
  }, [ensureDraft, rota, activeTenantId, showToast]);

  // Single paint handler — used for both single click (lo === hi) and drag
  // ranges. Clamps to the pre-midnight window (Phase 1 limitation) and
  // routes to useRotaShifts.applyPaint, which does the optimistic local
  // update + background DB write. ensureDraft is fired in parallel so the
  // dept badge updates in the same frame as the cells.
  const handlePaint = useCallback(async (crewMember, loSlot, hiSlot) => {
    if (!rota?.id) { showToast('No active rota resolved — cannot edit yet.'); return; }
    const lo0 = Math.min(loSlot, hiSlot);
    const hi0 = Math.max(loSlot, hiSlot);
    if (lo0 > LAST_PRE_MIDNIGHT_SLOT) {
      showToast('Editing the post-midnight window ships in a later phase.');
      return;
    }
    const lo = lo0;
    const hi = Math.min(hi0, LAST_PRE_MIDNIGHT_SLOT); // silently clamp range
    const erase = shiftType === 'erase';

    // Dept draft sync runs in parallel — its result only matters for the
    // HOD-no-init error toast; it does NOT block the paint.
    syncDeptDraft(crewMember);

    const res = await applyPaint({
      crewMember,
      loSlot: lo,
      hiSlot: hi,
      type: erase ? null : shiftType,
      erase,
      rotaId: rota.id,
      tripId: rota.ownerType === 'trip' ? rota.tripId : null,
      createdByMemberId: myMemberId,
      gridStartHour: GRID_START_HOUR,
    });
    if (!res.ok) showToast(`Couldn’t save that change — try again. (${res.error})`);
  }, [rota, shiftType, myMemberId, applyPaint, syncDeptDraft, showToast]);

  const canEdit = !!rota?.id && !loading && !error;
  const enterEdit = useCallback(() => {
    if (!canEdit) return;
    setEditMode(true);
    refetch({ silent: true });
  }, [canEdit, refetch]);
  const exitEdit = useCallback(() => {
    setEditMode(false);
    refetch({ silent: true });
  }, [refetch]);

  // Friendly dept name for toasts / aria-labels — falls back to "department"
  // when the dept lookup hasn't resolved yet.
  const targetDeptName = (departments.find((d) => d.id === targetDeptId) || {}).name || null;

  // Footer handlers — go straight to the Phase-2 RPC writers. Loading
  // state via ctaBusy disables both buttons during the in-flight call.
  // The pre-checks (sub-commits 2 + 3) layer on top of these in their
  // own sub-commits.
  const handleFooterSubmit = useCallback(async () => {
    if (!rota?.id || !targetDeptId || ctaBusy) return;
    setCtaBusy('submit');
    // Pre-check 1: at least one draft shift must exist for this dept.
    // take_rota_shift_snapshot raises on zero shifts (Phase 2 RPC error
    // path), so this is the polite gate that surfaces the right copy.
    const draftCheck = await getDraftShiftCount(rota.id, rota.tenantId, targetDeptId);
    if (!draftCheck.ok) {
      setCtaBusy(null);
      showToast(`Couldn’t check shifts — ${draftCheck.error || 'try again.'}`, { error: true });
      return;
    }
    if (draftCheck.count === 0) {
      setCtaBusy(null);
      showToast(
        `Cannot submit — no shifts for ${targetDeptName || 'this department'}.`,
        { error: true },
      );
      return;
    }
    // Pre-check 2: a CHIEF must exist in this dept to receive the
    // submission. Phase 1's review_items policy gates UPDATE on
    // CHIEF+dept-match; without a CHIEF the inbox row is un-actionable.
    // Client-side gate prevents the orphaned review_item; the writer
    // remains the safety net for race / RLS edges.
    const chiefCheck = await hasChiefForDepartment(rota.tenantId, targetDeptId);
    if (!chiefCheck.ok) {
      setCtaBusy(null);
      showToast(`Couldn’t check reviewers — ${chiefCheck.error || 'try again.'}`, { error: true });
      return;
    }
    if (!chiefCheck.has) {
      setCtaBusy(null);
      showToast(
        `No CHIEF available to review ${targetDeptName || 'this department'} — ask COMMAND to publish directly.`,
        { error: true },
      );
      return;
    }
    const res = await submitRotaDepartment({
      rotaId: rota.id,
      departmentId: targetDeptId,
    });
    setCtaBusy(null);
    if (!res.ok) {
      showToast(`Couldn’t submit — ${res.error || 'try again.'}`, { error: true });
      return;
    }
    showToast(`Submitted ${targetDeptName || 'department'} for approval.`);
    exitEdit();
  }, [rota, targetDeptId, ctaBusy, targetDeptName, showToast, exitEdit]);

  const handleFooterPublish = useCallback(async () => {
    if (!rota?.id || !targetDeptId || ctaBusy) return;
    setCtaBusy('publish');
    // Pre-check: at least one draft shift must exist (same rationale
    // as the submit gate — take_rota_shift_snapshot raises on zero).
    const draftCheck = await getDraftShiftCount(rota.id, rota.tenantId, targetDeptId);
    if (!draftCheck.ok) {
      setCtaBusy(null);
      showToast(`Couldn’t check shifts — ${draftCheck.error || 'try again.'}`, { error: true });
      return;
    }
    if (draftCheck.count === 0) {
      setCtaBusy(null);
      showToast(
        `Cannot publish — no shifts for ${targetDeptName || 'this department'}.`,
        { error: true },
      );
      return;
    }
    const res = await publishRotaDepartmentDirect({
      rotaId: rota.id,
      departmentId: targetDeptId,
      note: null,
    });
    setCtaBusy(null);
    if (!res.ok) {
      showToast(`Couldn’t publish — ${res.error || 'try again.'}`, { error: true });
      return;
    }
    showToast(`Published ${targetDeptName || 'department'}.`);
    exitEdit();
  }, [rota, targetDeptId, ctaBusy, targetDeptName, showToast, exitEdit]);

  return (
    <>
      <Header />
      <div className="editorial-page">

        <button type="button" className="crew-rota-back" onClick={() => navigate(-1)}>
          ← Back to trip
        </button>

        <div className="crew-rota-titleblock">
          <div className="crew-rota-meta">{meta}</div>
          <h1 className="crew-rota-title">
            The <em>rota</em>.
          </h1>
        </div>

        {/* Unified control bar — pills | date stepper */}
        <div className="crew-rota-controls">
          <div className="crew-rota-pillgroup">
            <button
              type="button"
              className={`crew-rota-pill${isToday ? ' active' : ''}`}
              onClick={() => setSelectedDate(realToday)}
              title={isToday ? 'You are viewing today' : 'Jump to today'}
            >Today</button>
            <button
              type="button"
              className={`crew-rota-pill${view === 'week' ? ' active' : ''}`}
              onClick={() => setView(view === 'week' ? 'grid' : 'week')}
              title={view === 'week' ? 'Back to day view' : 'Switch to week view'}
            >Week</button>
            <button type="button" className="crew-rota-pill disabled" aria-disabled="true" title="Coming soon">Hours of rest log</button>
          </div>
          <div className="crew-rota-divider" />
          <div className="crew-rota-stepper">
            <button
              type="button"
              className="crew-rota-stepper-btn is-active"
              aria-label={view === 'week' ? 'Previous week' : 'Previous day'}
              title={view === 'week' ? 'Previous week' : 'Previous day'}
              onClick={() => setSelectedDate((s) => addLocalDays(s, view === 'week' ? -7 : -1))}
            >←</button>
            <span className="crew-rota-stepper-anchor">
              <button
                type="button"
                className="crew-rota-stepper-date is-button"
                onClick={() => setDatePickerOpen((o) => !o)}
                aria-haspopup="dialog"
                aria-expanded={datePickerOpen}
                aria-label={view === 'week'
                  ? `Week starting ${fullDateLabel(selectedDateObj)}, ending ${fullDateLabel(parseLocalDate(addLocalDays(selectedDate, 6)))}. Pick a date.`
                  : undefined}
                title={view === 'week' ? 'Pick a week start' : 'Pick a date'}
              >
                <CalendarIcon size={13} />
                {view === 'week'
                  ? weekRangeLabelLong(selectedDate)
                  : fullDateLabel(selectedDateObj)}
              </button>
              <MonthPicker
                open={datePickerOpen}
                value={selectedDate}
                onChange={setSelectedDate}
                onClose={() => setDatePickerOpen(false)}
              />
            </span>
            <button
              type="button"
              className="crew-rota-stepper-btn is-active"
              aria-label={view === 'week' ? 'Next week' : 'Next day'}
              title={view === 'week' ? 'Next week' : 'Next day'}
              onClick={() => setSelectedDate((s) => addLocalDays(s, view === 'week' ? 7 : 1))}
            >→</button>
            {view !== 'week' && (
              <span className="crew-rota-stepper-helper">
                click any name for the rest panel
              </span>
            )}
          </div>
        </div>

        {/* Body card with its own header / body / footer */}
        <div className={`crew-rota-card${editMode ? ' is-editing' : ''}`}>
          <div className="crew-rota-card-header">
            <div className="crew-rota-card-context">{cardContext}</div>
            <div className="crew-rota-pillgroup">
              <button
                type="button"
                className={`crew-rota-pill${view === 'grid' ? ' active' : ''}`}
                onClick={() => setView('grid')}
              >Grid</button>
              <button
                type="button"
                className={`crew-rota-pill${view === 'list' ? ' active' : ''}`}
                onClick={() => setView('list')}
              >List</button>
              {view !== 'week' && (editMode ? (
                <button
                  type="button"
                  className="crew-rota-pill active edit-pill"
                  onClick={exitEdit}
                >Done</button>
              ) : (
                <button
                  type="button"
                  className={`crew-rota-pill edit-pill${canEdit ? '' : ' disabled'}`}
                  aria-disabled={!canEdit}
                  title={canEdit ? 'Edit the rota' : 'Rota not ready'}
                  onClick={enterEdit}
                ><Pencil size={12} /> Edit</button>
              ))}
            </div>
          </div>

          {editMode && view === 'grid' && (
            <div className="crew-rota-typebar" role="radiogroup" aria-label="Shift type">
              <span className="crew-rota-typebar-label">New shift</span>
              {SHIFT_TYPE_PILLS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={shiftType === key}
                  className={`crew-rota-pill${shiftType === key ? ' active' : ''}`}
                  onClick={() => setShiftType(key)}
                >{label}</button>
              ))}
              <span className="crew-rota-typebar-sep" aria-hidden />
              <button
                type="button"
                className="crew-rota-pill"
                onClick={() => setPickerOpen(true)}
                title="Open template library"
              >Templates</button>
            </div>
          )}

          <div className="crew-rota-card-body">
            {loading ? (
              <div style={{
                padding: '48px 0', textAlign: 'center',
                fontFamily: 'var(--font-sans)', fontSize: 13,
                color: 'var(--ink-muted)', fontStyle: 'italic',
              }}>
                Loading the rota…
              </div>
            ) : error ? (
              <div style={{
                padding: '48px 0', textAlign: 'center',
                fontFamily: 'var(--font-sans)', fontSize: 13, color: '#7A2E1E',
              }}>
                Couldn't load the rota. {error}
              </div>
            ) : view === 'week' ? (
              <CrewWeekMatrix
                crew={crew}
                windowShifts={windowShifts || []}
                selectedDate={selectedDate}
                realToday={realToday}
                gridStartHour={GRID_START_HOUR}
                onCellClick={(d) => { setSelectedDate(d); setView('grid'); }}
                onStepDay={(delta) => setSelectedDate((s) => addLocalDays(s, delta))}
              />
            ) : (
              <>
                {hasNoShifts && !editMode ? (
                  <div className="crew-rota-empty">
                    <div className="crew-rota-empty-msg">
                      No shifts on {fullDateLabel(selectedDateObj)}.
                    </div>
                    {!isToday && (
                      <div className="crew-rota-empty-cta">
                        <button type="button" onClick={() => setSelectedDate(realToday)}>
                          Jump to today
                        </button>
                      </div>
                    )}
                  </div>
                ) : view === 'grid' ? (
                  <RotaTodayGrid
                    crew={crew}
                    now={isToday ? now : null}
                    gridStartHour={GRID_START_HOUR}
                    onCrewClick={setSelectedCrew}
                    editMode={editMode}
                    onPaint={handlePaint}
                    deptStatus={statusByDept}
                  />
                ) : (
                  <CrewListView crew={crew} onCrewClick={setSelectedCrew} />
                )}
              </>
            )}
          </div>

          <div className="crew-rota-card-footer">
            {editMode ? (
              <EditFooterCTA
                tier={tier}
                draftDayCount={draftDayCount}
                targetDeptId={targetDeptId}
                targetDeptName={targetDeptName}
                busy={ctaBusy}
                onSubmit={handleFooterSubmit}
                onPublish={handleFooterPublish}
              />
            ) : (
              <>
                {view === 'grid' ? (
                  <RotaLegend now={isToday ? now : null} />
                ) : view === 'week' ? (
                  <span>Click any cell to open that day’s grid.</span>
                ) : (
                  <span>Click a name for their rest panel.</span>
                )}
                {showPendingReviewNotice && (
                  <span style={{ fontStyle: 'italic' }}>
                    {pendingReviewCount} submission{pendingReviewCount === 1 ? '' : 's'} awaiting review ·{' '}
                    <a href="/reviews">review</a>
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        <PatternPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          templates={templates}
          loading={templatesLoading}
          error={templatesError}
          toggleStar={toggleStar}
          departments={departments}
          myDeptId={currentUser?.department_id || null}
          onToast={showToast}
          onPick={(t) => {
            // Phase 3a — open apply modal for any kind. Simple flows
            // through to a working apply; shift patterns render the 3b
            // stub inside the modal until that path lands.
            setPickerOpen(false);
            setApplyTarget(t);
          }}
          onEdit={(t) => {
            setPickerOpen(false);
            setEditor({ kind: t.kind === 'rotation' ? 'rotation' : 'simple', template: t });
          }}
          onNew={(kind) => {
            setPickerOpen(false);
            setEditor({ kind: kind === 'rotation' ? 'rotation' : 'simple', template: null });
          }}
        />

        <SimpleTemplateEditor
          open={editor?.kind === 'simple'}
          template={editor?.template || null}
          departments={departments}
          myDeptId={currentUser?.department_id || null}
          vesselId={rota?.vesselId || null}
          onClose={() => { setEditor(null); setPickerOpen(true); }}
          createTemplate={createTemplate}
          updateTemplate={updateTemplate}
          deleteTemplate={deleteTemplate}
          onToast={showToast}
        />

        <RotationTemplateEditor
          open={editor?.kind === 'rotation'}
          template={editor?.template || null}
          departments={departments}
          myDeptId={currentUser?.department_id || null}
          vesselId={rota?.vesselId || null}
          crew={crew}
          onClose={() => { setEditor(null); setPickerOpen(true); }}
          createTemplate={createTemplate}
          updateTemplate={updateTemplate}
          deleteTemplate={deleteTemplate}
          onToast={showToast}
        />

        <ApplyTemplateModal
          open={!!applyTarget}
          template={applyTarget}
          rota={rota}
          trip={null /* /crew is the standing rota — no trip context. Trip rotas land in a later phase. */}
          crew={crew}
          currentUser={currentUser}
          tier={tier}
          myMemberId={myMemberId}
          applyTemplate={applyTemplate}
          ensureDraft={ensureDraft}
          onToast={showToast}
          onClose={() => { setApplyTarget(null); setPickerOpen(true); }}
          onApplied={() => { setApplyTarget(null); setPickerOpen(false); }}
        />

        {toast && (
          <div
            className={`crew-rota-toast${toast.error ? ' error' : ''}`}
            role={toast.error ? 'alert' : 'status'}
          >{toast.msg}</div>
        )}

      </div>

      <RestPanelPopover crew={selectedCrew} onClose={() => setSelectedCrew(null)} />
    </>
  );
}

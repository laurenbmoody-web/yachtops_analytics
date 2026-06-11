import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Pencil, Calendar as CalendarIcon, Trash2 } from 'lucide-react';
import MonthPicker from './MonthPicker';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import RotaTodayGrid from '../trip-detail-view-with-guest-allocation/components/RotaTodayGrid';
import { DEPT_ORDER } from '../trip-detail-view-with-guest-allocation/sections/SectionCrew';
import CrewListView from './CrewListView';
import CrewWeekMatrix, { weekRangeLabel, weekRangeLabelLong } from './CrewWeekMatrix';
import HodEditConfirmModal from './HodEditConfirmModal';
import CancelEditModal from './CancelEditModal';
import ClearRotaModal from './ClearRotaModal';
import RestPanelPopover from './RestPanelPopover';
import PatternPicker from './PatternPicker';
import SimpleTemplateEditor from './SimpleTemplateEditor';
import RotationTemplateEditor from './RotationTemplateEditor';
import ApplyTemplateModal from './ApplyTemplateModal';
import { useRotaShifts } from './useRotaShifts';
import { useRotaTemplates } from './useRotaTemplates';
import { useRotaDepartmentStatus } from './useRotaDepartmentStatus';
import { clearRota } from './useRotaLifecycleWriters';
import { getDraftDayCount } from './rotaLifecycleChecks';
import './crew-rota.css';

// RotaWorkspace — the shared rota composition extracted from /crew.
//
// Owns everything inside the old /crew "card": the control bar (Today/Week
// pills + date stepper + MonthPicker), the Grid/List/Edit toggle, edit mode
// + drag-paint, the brush typebar, the template modals, the day grid / week
// matrix / list views, MLC overlays, and the rest-panel popover.
//
// It does NOT own the page eyebrow/title or the footer buttons — those are
// page chrome supplied via the `header` and `footer` render-props, which are
// each called with the workspace's live state bag so the chrome can react to
// it (view, selectedDate, crew, editMode, draftDayCount, …) without the
// parent having to lift any state.
//
// Props:
//   rota             resolved rota object { id, ownerType, tripId, vesselId, tenantId }
//   departmentId     optional — scope the grid to one department (null = all)
//   mode             'submitter' (/crew) | 'reviewer' (/reviews)
//   baselineSnapshot optional — reviewer diff baseline (wired in a later sub-commit)
//   onToast          (msg, opts?) — surface a toast through the parent
//   header           ({ ...state }) => ReactNode — page title block slot
//   footer           ({ ...state }) => ReactNode — page footer slot (inside the card)

const GRID_START_HOUR = 6;
// Brush pills. "Off" is no longer a shift type — an empty cell IS the off
// state. Erase removes the working shift.
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

export default function RotaWorkspace({
  rota,
  departmentId = null,
  mode = 'submitter',
  // eslint-disable-next-line no-unused-vars
  baselineSnapshot = null,
  initialDate = null,
  highlightSlots = null,
  onToast,
  header,
  footer,
}) {
  const now = new Date();
  const realToday = localTodayStr();
  const { user, currentUser, tenantRole, activeTenantId } = useAuth();
  const [view, setView] = useState('grid');      // 'grid' | 'list' | 'week'
  // initialDate lets a consumer open the grid on a specific day — the review
  // pane opens on the submission's first shift date so its shifts are visible
  // immediately. Defaults to today (the /crew behaviour).
  const [selectedDate, setSelectedDate] = useState(initialDate || realToday);
  const isToday = selectedDate === realToday;
  const selectedDateObj = parseLocalDate(selectedDate);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [selectedCrew, setSelectedCrew] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [shiftType, setShiftType] = useState('duty');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editor, setEditor] = useState(null);
  const [applyTarget, setApplyTarget] = useState(null);

  const tier = String(user?.permission_tier || tenantRole || '').toUpperCase();

  const showToast = useCallback((msg, opts) => onToast?.(msg, opts), [onToast]);

  const {
    crew, windowShifts, loading, error,
    applyPaint, applyTemplate, refetch,
  } = useRotaShifts(
    selectedDate,
    {
      // Day view: trailing 7. Week view: ±6 around selectedDate for per-cell
      // MLC context. rotaId + departmentId scope the fetch to this rota/dept.
      ...(view === 'week' ? { historyDays: 6, forwardDays: 6 } : { historyDays: 6, forwardDays: 0 }),
      rotaId: rota?.id || null,
      departmentId,
    },
  );
  const { statusByDept, ensureDraft } = useRotaDepartmentStatus(rota?.id);

  // The footer dept context — submitter mode targets the acting user's own
  // dept; reviewer mode targets the dept under review (the scope prop).
  const footerDeptId = mode === 'reviewer'
    ? (departmentId || null)
    : (currentUser?.department_id || null);

  // Per-dept day count for the submitter footer label / disable check.
  // DISTINCT draft days for footerDeptId, across the WHOLE rota — not just the
  // loaded ±6-day window (which previously under-counted multi-week drafts).
  // The whole-rota set is fetched (debounced) and UNIONed with the live window
  // set so the label still ticks up immediately as cells are painted.
  const [fetchedDraftDays, setFetchedDraftDays] = useState([]);
  useEffect(() => {
    if (!rota?.id || !rota?.tenantId || !footerDeptId) { setFetchedDraftDays([]); return undefined; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await getDraftDayCount(rota.id, rota.tenantId, footerDeptId);
      if (!cancelled && res.ok) setFetchedDraftDays(res.days);
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [rota?.id, rota?.tenantId, footerDeptId, windowShifts]);

  const draftDayCount = useMemo(() => {
    if (!footerDeptId) return 0;
    const deptMemberIds = new Set(
      crew.filter((c) => c.departmentId === footerDeptId).map((c) => c.id),
    );
    const days = new Set(fetchedDraftDays);
    for (const s of (windowShifts || [])) {
      if (s.status === 'draft' && deptMemberIds.has(s.memberId)) {
        days.add(s.date);
      }
    }
    return days.size;
  }, [footerDeptId, windowShifts, crew, fetchedDraftDays]);

  // Reviewer diff count vs the submission baseline — wired in a later
  // sub-commit. 0 for now so the footer slot signature is stable.
  const editCount = 0;

  const {
    templates, loading: templatesLoading, error: templatesError,
    toggleStar, createTemplate, updateTemplate, deleteTemplate,
  } = useRotaTemplates();

  // Departments for the template editors — get_tenant_departments
  // INTERSECTED with vessels.departments_in_use (see /crew history for the
  // rationale; the RPC's p_tenant_id is a membership gate, not a scope).
  const [departments, setDepartments] = useState([]);
  useEffect(() => {
    if (!activeTenantId) { setDepartments([]); return undefined; }
    let alive = true;
    (async () => {
      const [veRes, dpRes] = await Promise.all([
        supabase.from('vessels')
          .select('departments_in_use').eq('tenant_id', activeTenantId).maybeSingle(),
        supabase.rpc('get_tenant_departments', { p_tenant_id: activeTenantId }),
      ]);
      if (!alive) return;
      if (dpRes.error) {
        console.error('[RotaWorkspace] get_tenant_departments error:', dpRes.error);
        setDepartments([]);
        return;
      }
      const all = (dpRes.data || []).map((d) => ({ id: d.id, name: d.name }));
      const inUse = Array.isArray(veRes.data?.departments_in_use)
        ? veRes.data.departments_in_use
        : null;
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
  const onDuty = crew.filter((c) => c.onNow && !c.offToday).length;
  const presentDepts = DEPT_ORDER.filter((d) => crew.some((c) => c.department === d));
  const cardContext = isToday
    ? `${presentDepts.join(' · ')}  —  ${total} crew · ${onDuty} on duty`
    : `${presentDepts.join(' · ')}  —  ${total} crew`;

  // The acting user's own tenant_members.id — stamped on shift inserts.
  const myMemberId = crew.find((c) => c.userId === user?.id)?.id || null;

  // After any shift write, mark the affected department's status row draft.
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

  // Single paint handler — single click (lo === hi) and drag ranges both.
  const handlePaint = useCallback(async (crewMember, loSlot, hiSlot) => {
    if (!rota?.id) { showToast('No active rota resolved — cannot edit yet.'); return; }
    const lo0 = Math.min(loSlot, hiSlot);
    const hi0 = Math.max(loSlot, hiSlot);
    if (lo0 > LAST_PRE_MIDNIGHT_SLOT) {
      showToast('Editing the post-midnight window ships in a later phase.');
      return;
    }
    const lo = lo0;
    const hi = Math.min(hi0, LAST_PRE_MIDNIGHT_SLOT);
    const erase = shiftType === 'erase';

    // Submitter editing marks the dept draft (the "editing reverts to draft"
    // rule). A REVIEWER editing during approval must NOT revert it — the dept
    // has to stay pending_approval so Accept-with-edits can approve it; the
    // new draft shifts are published by the approve writer.
    if (mode === 'submitter') syncDeptDraft(crewMember);

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
  }, [rota, mode, shiftType, myMemberId, applyPaint, syncDeptDraft, showToast]);

  const canEdit = !!rota?.id && !loading && !error;
  const [hodConfirmOpen, setHodConfirmOpen] = useState(false);

  // ── HOD discard model ──────────────────────────────────────────────────────
  // Grid edits autosave to rota_shifts the moment they're made, so "back out
  // without saving" is a real revert: snapshot the dept's shifts when edit mode
  // opens, restore that snapshot on discard. A non-null snapshotRef marks an
  // UNCOMMITTED session — explicit Save clears it (edits kept); Discard or
  // leaving the page (in-app nav / tab close) restores it.
  const isHodEditor = mode === 'submitter' && tier === 'HOD' && !!footerDeptId;
  const snapshotRef = useRef(null);   // { rotaId, memberIds, rows } | null
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reverting, setReverting] = useState(false);
  // Columns proven to exist by the insert (useRotaShifts) + load select paths.
  const SNAP_COLS = 'id, tenant_id, rota_id, member_id, shift_date, start_time, end_time, shift_type, sub_type, notes, status, trip_id, created_by';

  const captureSnapshot = useCallback(async () => {
    if (!rota?.id || !footerDeptId) { snapshotRef.current = null; return; }
    const memberIds = crew.filter((c) => c.departmentId === footerDeptId).map((c) => c.id);
    const { data, error: snapErr } = await supabase
      .from('rota_shifts').select(SNAP_COLS)
      .eq('rota_id', rota.id).in('member_id', memberIds.length ? memberIds : ['00000000-0000-0000-0000-000000000000']);
    if (snapErr) {
      // No baseline → don't pretend we can discard. Session behaves as before.
      console.warn('[RotaWorkspace] edit snapshot failed:', snapErr.message || snapErr);
      snapshotRef.current = null;
      return;
    }
    snapshotRef.current = { rotaId: rota.id, memberIds, rows: data || [] };
  }, [rota, footerDeptId, crew]);

  // Restore the dept to the snapshot: clear the current scope, reinsert the
  // captured rows (original ids preserved so any FK references survive).
  const restoreSnapshot = useCallback(async (snap) => {
    if (!snap?.rotaId || !snap.memberIds?.length) return;
    await supabase.from('rota_shifts').delete()
      .eq('rota_id', snap.rotaId).in('member_id', snap.memberIds);
    if (snap.rows.length) await supabase.from('rota_shifts').insert(snap.rows);
  }, []);

  const beginEditMode = useCallback(async () => {
    // Capture the baseline BEFORE the grid becomes editable, so the first edit
    // can't leak into the snapshot.
    if (isHodEditor) await captureSnapshot();
    setEditMode(true);
    refetch({ silent: true });
  }, [isHodEditor, captureSnapshot, refetch]);
  const enterEdit = useCallback(() => {
    if (!canEdit) return;
    // The HOD edit-while-non-draft confirm only applies to submitter mode
    // (a HOD on their own dept). Reviewers (CHIEF/COMMAND) bypass it. The
    // dept status is per (rota, dept) — not per day — so a publish yesterday
    // marks the dept 'published' on every date. Only warn when the day being
    // opened actually carries this dept's shifts; an empty day has nothing
    // to revert, and the warning would just be noise.
    if (mode === 'submitter' && tier === 'HOD' && footerDeptId) {
      const status = statusByDept.get(footerDeptId)?.status;
      if (status === 'pending_approval' || status === 'published') {
        const deptIds = new Set(
          crew.filter((c) => c.departmentId === footerDeptId).map((c) => c.id),
        );
        const dayHasShifts = (windowShifts || []).some(
          (s) => s.date === selectedDate && deptIds.has(s.memberId),
        );
        if (dayHasShifts) {
          setHodConfirmOpen(true);
          return;
        }
      }
    }
    beginEditMode();
  }, [canEdit, mode, tier, footerDeptId, statusByDept, crew, windowShifts, selectedDate, beginEditMode]);
  const exitEdit = useCallback(() => {
    // Any path through exitEdit is a commit (Save, Submit-for-approval, or a
    // non-HOD Done): the edits stand, so drop the discard baseline. Only an
    // uncommitted leave (unmount without exitEdit) keeps the snapshot to revert.
    snapshotRef.current = null;
    setEditMode(false);
    refetch({ silent: true });
  }, [refetch]);

  // HOD "Cancel" — prompt to Save / Discard / Keep editing. Non-HOD editors
  // (CHIEF/COMMAND) keep the plain "Done" exit with no prompt.
  const handleCancelClick = useCallback(() => {
    if (isHodEditor && snapshotRef.current) { setCancelOpen(true); return; }
    exitEdit();
  }, [isHodEditor, exitEdit]);
  const handleSaveExit = useCallback(() => {
    snapshotRef.current = null;            // commit: keep the autosaved edits
    setCancelOpen(false);
    exitEdit();
  }, [exitEdit]);
  const handleDiscardExit = useCallback(async () => {
    const snap = snapshotRef.current;
    setReverting(true);
    await restoreSnapshot(snap);
    snapshotRef.current = null;
    setReverting(false);
    setCancelOpen(false);
    exitEdit();
    showToast('Changes discarded — rota restored.');
  }, [restoreSnapshot, exitEdit, showToast]);

  // Leaving the page while a HOD edit session is uncommitted = discard, per
  // the "click out and it doesn't save" rule. beforeunload warns on tab
  // close/refresh; the unmount cleanup reverts on in-app navigation away.
  // (react-router 6.0.2 has no navigation blocker, so an in-app leave can't
  // show this app's popup — it silently discards, which matches intent.)
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (snapshotRef.current) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (snapshotRef.current) {
        restoreSnapshot(snapshotRef.current);   // fire-and-forget on unmount
        snapshotRef.current = null;
      }
    };
  }, [restoreSnapshot]);

  // COMMAND-only "clear rota" — wipes a day or the whole rota back to a blank
  // slate. Gated to COMMAND on /crew (submitter mode). Routed through the
  // clear_rota RPC, which (atomically, as COMMAND) deletes the shifts AND the
  // pending review submissions for the affected departments and resets those
  // depts back to draft — so a clear no longer strands a dead submission in the
  // chief's /reviews queue.
  const canClear = mode === 'submitter' && tier === 'COMMAND' && !!rota?.id;
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(null);   // null | 'day' | 'all'
  const handleClearRota = useCallback(async (scope) => {
    if (!rota?.id || clearing) return;
    setClearing(scope);
    const res = await clearRota({
      rotaId: rota.id,
      scope: scope === 'day' ? 'day' : 'all',
      date: scope === 'day' ? selectedDate : null,
    });
    setClearing(null);
    if (!res.ok) {
      showToast(`Couldn’t clear — ${res.error || 'try again.'}`, { error: true });
      return;
    }
    setClearOpen(false);
    if (editMode) { snapshotRef.current = null; setEditMode(false); }
    refetch({ silent: true });
    const n = res.data?.reviews_cleared || 0;
    const reviewNote = n ? ` ${n} review submission${n === 1 ? '' : 's'} cleared.` : '';
    showToast((scope === 'day'
      ? `Cleared all shifts on ${fullDateLabel(selectedDateObj)}.`
      : 'Rota cleared — all shifts removed.') + reviewNote);
  }, [rota, clearing, editMode, refetch, showToast, selectedDate, selectedDateObj]);

  // Friendly dept name for the HOD confirm copy.
  const footerDeptName = (departments.find((d) => d.id === footerDeptId) || {}).name || null;

  // State bag handed to both chrome slots so they can react to live workspace
  // state without the parent lifting any of it.
  const slotState = {
    view, selectedDate, selectedDateObj, isToday, now: isToday ? now : null,
    crew, total, onDuty, editMode, draftDayCount, editCount,
    enterEdit, exitEdit,
  };

  return (
    <>
      {header ? header(slotState) : null}

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
                onClick={isHodEditor ? handleCancelClick : exitEdit}
              >{isHodEditor ? 'Cancel' : 'Done'}</button>
            ) : (
              <button
                type="button"
                className={`crew-rota-pill edit-pill${canEdit ? '' : ' disabled'}`}
                aria-disabled={!canEdit}
                title={canEdit ? 'Edit the rota' : 'Rota not ready'}
                onClick={enterEdit}
              ><Pencil size={12} /> Edit</button>
            ))}
            {canClear && (
              <button
                type="button"
                className="crew-rota-pill clear-pill"
                onClick={() => setClearOpen(true)}
                title="Clear every shift on this rota (COMMAND only)"
                aria-label="Clear rota"
              ><Trash2 size={12} /> Clear rota</button>
            )}
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
          ) : crew.length === 0 ? (
            // Only a truly crew-less rota gets the bare message. A day with
            // crew but no shifts still renders the grid — empty cells are
            // paintable, so COMMAND/CHIEF/HOD can drag hours straight in
            // rather than hitting a dead-end one-liner.
            <div className="crew-rota-empty">
              <div className="crew-rota-empty-msg">No crew on this rota yet.</div>
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
              highlightSlots={highlightSlots}
              viewDate={selectedDate}
            />
          ) : (
            <CrewListView crew={crew} onCrewClick={setSelectedCrew} />
          )}
        </div>

        <div className="crew-rota-card-footer">
          {footer ? footer(slotState) : null}
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
        trip={null /* standing rota — no trip context */}
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

      <HodEditConfirmModal
        open={hodConfirmOpen}
        currentStatus={footerDeptId ? statusByDept.get(footerDeptId)?.status : null}
        departmentName={footerDeptName}
        onCancel={() => setHodConfirmOpen(false)}
        onContinue={() => { setHodConfirmOpen(false); beginEditMode(); }}
      />

      <CancelEditModal
        open={cancelOpen}
        busy={reverting}
        onKeepEditing={() => { if (!reverting) setCancelOpen(false); }}
        onDiscard={handleDiscardExit}
        onSave={handleSaveExit}
      />

      <ClearRotaModal
        open={clearOpen}
        busy={clearing}
        dateLabel={fullDateLabel(selectedDateObj)}
        onCancel={() => setClearOpen(false)}
        onClearDay={() => handleClearRota('day')}
        onClearAll={() => handleClearRota('all')}
      />

      <RestPanelPopover crew={selectedCrew} onClose={() => setSelectedCrew(null)} />
    </>
  );
}

// Re-exported so the /crew page header slot can label dates the same way the
// control bar does, without duplicating the helpers.
export { fullDateLabel, weekRangeLabel };

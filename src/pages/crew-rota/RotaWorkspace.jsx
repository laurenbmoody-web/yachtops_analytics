import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Pencil, Calendar as CalendarIcon, Trash2 } from 'lucide-react';
import MonthPicker from './MonthPicker';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import RotaTodayGrid from '../trip-detail-view-with-guest-allocation/components/RotaTodayGrid';
import { DEPT_ORDER } from '../trip-detail-view-with-guest-allocation/sections/SectionCrew';
import CrewListView from './CrewListView';
import CrewWeekMatrix, { weekRangeLabel, weekRangeLabelLong } from './CrewWeekMatrix';
import RestLogView from './RestLogView';
import { MONTH_NAMES } from './MonthCalendar';
import HodEditConfirmModal from './HodEditConfirmModal';
import CancelEditModal from './CancelEditModal';
import ClearRotaModal from './ClearRotaModal';
import RestPanelPopover from './RestPanelPopover';
import CoverageApplyModal from './CoverageApplyModal';
import BreachNotesModal from '../crew-profile/components/BreachNotesModal';
import DepartmentFilter from './DepartmentFilter';
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

const DEFAULT_GRID_START_HOUR = 6;
// Brush pills. "Off" is no longer a shift type — an empty cell IS the off
// state. Erase removes the working shift.
const SHIFT_TYPE_PILLS = [
  ['duty', 'Duty'], ['watch', 'Watch'], ['standby', 'Standby'],
  ['training', 'Training'], ['medical', 'Medical'],
  ['erase', 'Erase'],
];
// Last paintable slot index (pre-midnight). Derived per-render from the
// vessel's configurable grid-start hour (see lastPreMidnightSlot below).

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
function toLocalYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Jump to the 1st of the month `delta` away — the HOR month-log stepper.
// Anchoring on the 1st keeps the derived calendar-month columns stable as
// the chief pages across months.
function addLocalMonths(s, delta) {
  const d = parseLocalDate(s);
  return toLocalYmd(new Date(d.getFullYear(), d.getMonth() + delta, 1));
}
// Day columns + fetch window + label for the HOR log, derived from the
// anchor date and the period. The window carries a 6-day lead-in before the
// first column so each cell's rolling-7-day weekly rest is accurate from
// day one. Returned historyDays/forwardDays feed useRotaShifts directly.
function horLogSpec(anchor, period) {
  if (period === 'week') {
    const days = [];
    for (let i = 0; i < 7; i += 1) days.push(addLocalDays(anchor, i));
    return { days, historyDays: 6, forwardDays: 6, label: weekRangeLabelLong(anchor) };
  }
  const d = parseLocalDate(anchor);
  const y = d.getFullYear();
  const m = d.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const days = [];
  for (let i = 1; i <= last.getDate(); i += 1) days.push(toLocalYmd(new Date(y, m, i)));
  const dayMs = 86400000;
  const historyDays = Math.round((d - first) / dayMs) + 6;
  const forwardDays = Math.round((last - d) / dayMs);
  return { days, historyDays, forwardDays, label: `${MONTH_NAMES[m]} ${y}` };
}

// Permission-tier hierarchy for HOR sign-off (mirrors _hor_tier_rank in the DB):
// a member can sign off when their rank ≥ the vessel's configured approver tier.
const TIER_RANK = { COMMAND: 3, CHIEF: 2, HOD: 1 };
const tierRank = (t) => TIER_RANK[String(t || '').toUpperCase()] || 0;

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
  const [view, setView] = useState('grid');      // 'grid' | 'list' | 'week' | 'hor'
  const [horPeriod, setHorPeriod] = useState('month'); // HOR log span: 'week' | 'month'
  // initialDate lets a consumer open the grid on a specific day — the review
  // pane opens on the submission's first shift date so its shifts are visible
  // immediately. Defaults to today (the /crew behaviour).
  const [selectedDate, setSelectedDate] = useState(initialDate || realToday);
  const isToday = selectedDate === realToday;
  const selectedDateObj = parseLocalDate(selectedDate);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [selectedCrew, setSelectedCrew] = useState(null);
  // Coverage-apply flow: a rest suggestion the chief chose to push to the grid.
  const [applySuggestion, setApplySuggestion] = useState(null);
  // Breach-notes flow: logging an MLC violation reason / note for a crew member,
  // reusing the crew-profile BreachNotesModal (the auditor-grade reason record).
  const [breachNotesFor, setBreachNotesFor] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [shiftType, setShiftType] = useState('duty');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editor, setEditor] = useState(null);
  const [applyTarget, setApplyTarget] = useState(null);
  // Which departments are shown in the grid. null until departments resolve,
  // then seeded per tier (see the init effect below). Drives the multi-select
  // department filter for COMMAND / CHIEF.
  const [visibleDeptIds, setVisibleDeptIds] = useState(null);

  const tier = String(user?.permission_tier || tenantRole || '').toUpperCase();

  const showToast = useCallback((msg, opts) => onToast?.(msg, opts), [onToast]);

  // HOR log columns + fetch window, derived from the anchor date + period.
  const hor = useMemo(() => horLogSpec(selectedDate, horPeriod), [selectedDate, horPeriod]);

  const {
    crew, windowShifts, loading, error,
    applyPaint, applyTemplate, refetch,
  } = useRotaShifts(
    selectedDate,
    {
      // Day view: trailing 7. Week view: ±6 around selectedDate for per-cell
      // MLC context. HOR log: the whole period + a 6-day lead-in for rolling
      // weekly rest. rotaId + departmentId scope the fetch to this rota/dept.
      // eslint-disable-next-line no-nested-ternary
      ...(view === 'hor'
        ? { historyDays: hor.historyDays, forwardDays: hor.forwardDays }
        : view === 'week'
          ? { historyDays: 6, forwardDays: 6 }
          : { historyDays: 6, forwardDays: 0 }),
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
  // Vessel-configurable rota grid-start hour (display + slot boundary). The
  // MLC rest math is calendar-day based and unaffected by this.
  const [gridStartHour, setGridStartHour] = useState(DEFAULT_GRID_START_HOUR);
  const [horDayBasis, setHorDayBasis] = useState('calendar');
  const [horApproverTier, setHorApproverTier] = useState('CHIEF');
  const [vesselName, setVesselName] = useState(null);
  // Vessel identity for the MLC/IMO-ILO Record of Hours of Rest header. These
  // live on `tenants` (single vessel per tenant), not on `vessels`.
  const [vesselIdentity, setVesselIdentity] = useState({ imoNumber: null, flagState: null, portOfRegistry: null });
  const lastPreMidnightSlot = (24 - gridStartHour) * 2 - 1;

  const [departments, setDepartments] = useState([]);
  useEffect(() => {
    if (!activeTenantId) { setDepartments([]); return undefined; }
    let alive = true;
    (async () => {
      const [veRes, dpRes, tnRes, viRes] = await Promise.all([
        supabase.from('vessels')
          .select('name, departments_in_use, operational_day_start_hour, hor_day_basis, hor_approver_tier').eq('tenant_id', activeTenantId).maybeSingle(),
        supabase.rpc('get_tenant_departments', { p_tenant_id: activeTenantId }),
        supabase.from('tenants')
          .select('imo_number, flag, port_of_registry').eq('id', activeTenantId).maybeSingle(),
        // Identity is entered in vessel-settings (which writes to vessels) but the
        // columns were migrated onto tenants — read both and prefer whichever has a
        // value so IMO / port / flag round-trip onto the PSC-audited record. Kept a
        // separate query so a missing column here can't break the name lookup above.
        supabase.from('vessels')
          .select('imo_number, flag, port_of_registry').eq('tenant_id', activeTenantId).maybeSingle(),
      ]);
      if (!alive) return;
      setGridStartHour(veRes.data?.operational_day_start_hour ?? DEFAULT_GRID_START_HOUR);
      setHorDayBasis(veRes.data?.hor_day_basis || 'calendar');
      setHorApproverTier(veRes.data?.hor_approver_tier || 'CHIEF');
      setVesselName(veRes.data?.name ?? null);
      setVesselIdentity({
        imoNumber: viRes.data?.imo_number ?? tnRes.data?.imo_number ?? null,
        flagState: viRes.data?.flag ?? tnRes.data?.flag ?? null,
        portOfRegistry: viRes.data?.port_of_registry ?? tnRes.data?.port_of_registry ?? null,
      });
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

  // HOR breach reasons for the visible period — keyed `${userId}|${date}` so the
  // Record-of-Rest export can show each non-conformity's recorded reason + sign-off.
  const [breachReasons, setBreachReasons] = useState({});
  const [workEntries, setWorkEntries] = useState([]);
  const [reasonsNonce, setReasonsNonce] = useState(0);
  const horFirstDay = hor.days?.[0];
  const horLastDay = hor.days?.[hor.days.length - 1];
  useEffect(() => {
    if (!activeTenantId || !horFirstDay || !horLastDay) return undefined;
    let alive = true;
    // Logged actuals are needed by BOTH the HOR/Rest Log tab and the planning
    // grid (so its rolling-rest warnings reflect what was actually worked).
    // Range: the HOR month plus a ±7-day cushion around the selected day, so the
    // week grid's trailing-7 context still has actuals at month boundaries.
    const weStart = [horFirstDay, addLocalDays(selectedDate, -7)].sort()[0];
    const weEnd = [horLastDay, addLocalDays(selectedDate, 7)].sort().reverse()[0];
    (async () => {
      if (view === 'hor') {
        const { data, error } = await supabase
          .from('hor_breach_reasons')
          .select('subject_user_id, breach_date, note_text, signed_off_at, signed_off_by, updated_at, updated_by')
          .eq('tenant_id', activeTenantId)
          .gte('breach_date', horFirstDay)
          .lte('breach_date', horLastDay);
        if (alive && !error && data) {
          const map = {};
          data.forEach((r) => { map[`${r.subject_user_id}|${String(r.breach_date).slice(0, 10)}`] = r; });
          // Merge (don't replace) so a just-saved optimistic entry is never clobbered
          // by a read that round-tripped the date/uuid in a slightly different shape.
          setBreachReasons((prev) => ({ ...prev, ...map }));
        }
      }
      // Crew's logged actual hours — these override the rota plan wherever a day
      // is logged (logged actuals are the source of truth) for both the HOR
      // record and the grid's breach assessment.
      const we = await supabase
        .from('hor_work_entries')
        .select('subject_user_id, entry_date, work_segments')
        .eq('tenant_id', activeTenantId)
        .gte('entry_date', weStart)
        .lte('entry_date', weEnd);
      if (alive && !we.error && we.data) setWorkEntries(we.data);
    })();
    return () => { alive = false; };
  }, [view, activeTenantId, horFirstDay, horLastDay, selectedDate, reasonsNonce]);

  // After the modal saves, fold the reasons straight into state keyed exactly as
  // the breach exclusion reads them (`${userId}|${date}`) — so the banner/list
  // update instantly and deterministically — then bump the nonce to reconcile
  // with the DB.
  const handleReasonsSaved = useCallback((saved) => {
    if (Array.isArray(saved) && saved.length) {
      setBreachReasons((prev) => {
        const next = { ...prev };
        const nowIso = new Date().toISOString();
        saved.forEach((s) => {
          next[`${s.userId}|${s.date}`] = {
            subject_user_id: s.userId, breach_date: s.date,
            note_text: s.note,
            signed_off_at: nowIso, signed_off_by: user?.id,
            updated_at: nowIso, updated_by: user?.id,
          };
        });
        return next;
      });
    }
    setReasonsNonce((n) => n + 1);
  }, []);

  const departmentName = useMemo(
    () => (departmentId ? (departments.find((d) => d.id === departmentId)?.name || null) : null),
    [departmentId, departments],
  );

  // ── Permission-scoped visibility + edit access ────────────────────────────
  const ownDeptId = currentUser?.department_id || null;
  // Departments actually present on this rota (id + name), for the filter.
  const presentDeptList = useMemo(() => {
    const seen = new Map();
    for (const c of crew) {
      if (c.departmentId && !seen.has(c.departmentId)) seen.set(c.departmentId, c.department);
    }
    return Array.from(seen, ([id, name]) => ({ id, name }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [crew]);

  // Departments the viewer may EDIT. null = all (COMMAND). A CHIEF / HOD edits
  // their own department only; crew edit nothing. Reviewers edit the dept
  // under review. Other visible departments render read-only.
  const editableDeptIds = useMemo(() => {
    if (mode === 'reviewer') return departmentId ? new Set([departmentId]) : null;
    if (tier === 'COMMAND') return null;
    if ((tier === 'CHIEF' || tier === 'HOD') && ownDeptId) return new Set([ownDeptId]);
    return new Set();
  }, [mode, departmentId, tier, ownDeptId]);

  // The filter is offered to viewers who can see more than one department.
  const canFilterDepts = (tier === 'COMMAND' || tier === 'CHIEF') && presentDeptList.length > 1;

  // Seed visible departments once they're known: COMMAND sees all; CHIEF
  // defaults to their own department (and expands others via the filter);
  // everyone else is already fetch-scoped to their own department.
  useEffect(() => {
    if (visibleDeptIds !== null || presentDeptList.length === 0) return;
    if (tier === 'CHIEF' && ownDeptId && presentDeptList.some((d) => d.id === ownDeptId)) {
      setVisibleDeptIds(new Set([ownDeptId]));
    } else {
      setVisibleDeptIds(new Set(presentDeptList.map((d) => d.id)));
    }
  }, [visibleDeptIds, presentDeptList, tier, ownDeptId]);

  // Crew filtered to the visible departments (dept-less crew always shown).
  const visibleCrew = useMemo(() => {
    if (!visibleDeptIds) return crew;
    return crew.filter((c) => !c.departmentId || visibleDeptIds.has(c.departmentId));
  }, [crew, visibleDeptIds]);

  const total = visibleCrew.length;
  const onDuty = visibleCrew.filter((c) => c.onNow && !c.offToday).length;
  const presentDepts = DEPT_ORDER.filter((d) => visibleCrew.some((c) => c.department === d));
  const cardContext = isToday
    ? `${presentDepts.join(' · ')}  —  ${total} crew · ${onDuty} on duty`
    : `${presentDepts.join(' · ')}  —  ${total} crew`;

  // The acting user's own tenant_members.id — stamped on shift inserts.
  const myMemberId = crew.find((c) => c.userId === user?.id)?.id || null;

  // Open the breach-notes modal for a crew member, deriving the breached day +
  // rule types from their LIVE MLC report (the same assessMlc the panel shows),
  // so the reason is filed against the exact rules that tripped on selectedDate.
  const RULE_TO_BREACH_TYPE = {
    daily_rest_10h: 'REST_LT_10_IN_24H',
    weekly_rest_77h: 'REST_LT_77_IN_7D',
    rest_period_split: 'NO_6H_CONTINUOUS_REST_IN_24H',
    max_work_stretch_14h: 'WORK_GT_14H_CONTINUOUS',
  };
  const openBreachNotes = (crewMember) => {
    if (!crewMember) return;
    const breaches = crewMember.mlcReport?.breaches || [];
    const breachTypes = [...new Set(
      breaches.map((b) => RULE_TO_BREACH_TYPE[b.rule]).filter(Boolean),
    )];
    const hasDaily = breaches.some((b) => b.rule === 'daily_rest_10h');
    const restHours = hasDaily ? crewMember.rest24hDecimal : crewMember.pastWeekHours;
    setBreachNotesFor({
      userId: crewMember.userId,
      breachedDates: [{ date: selectedDate, breachTypes, restHours }],
    });
    setSelectedCrew(null); // close the popover so the modal isn't obscured
  };

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
      tier,
    });
    if (!res.ok && res.reason === 'no-init') {
      showToast('Department status not initialized — ask a CHIEF or COMMAND to enable editing.');
    } else if (!res.ok && res.reason === 'error') {
      showToast(`Couldn’t update department state: ${res.detail || 'unknown error'}`);
    }
  }, [ensureDraft, rota, activeTenantId, showToast, tier]);

  // Single paint handler — single click (lo === hi) and drag ranges both.
  const handlePaint = useCallback(async (crewMember, loSlot, hiSlot) => {
    if (!rota?.id) { showToast('No active rota resolved — cannot edit yet.'); return; }
    // Edit-scope guard: a viewer can only paint departments they own. Other
    // departments are shown read-only (e.g. a chief expanding Deck for context).
    if (editableDeptIds && !editableDeptIds.has(crewMember.departmentId)) {
      showToast('You can only edit your own department’s rota.');
      return;
    }
    const lo0 = Math.min(loSlot, hiSlot);
    const hi0 = Math.max(loSlot, hiSlot);
    if (lo0 > lastPreMidnightSlot) {
      showToast('Editing the post-midnight window ships in a later phase.');
      return;
    }
    const lo = lo0;
    const hi = Math.min(hi0, lastPreMidnightSlot);
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
      gridStartHour,
    });
    if (!res.ok) showToast(`Couldn’t save that change — try again. (${res.error})`);
  }, [rota, mode, shiftType, myMemberId, applyPaint, syncDeptDraft, showToast, gridStartHour, lastPreMidnightSlot, editableDeptIds]);

  // Read-only tiers (crew) can view but never edit. Editors are COMMAND /
  // CHIEF / HOD (HOD submits for approval, CHIEF / COMMAND publish — enforced
  // by the footer CTA). Reviewer mode (/reviews) is always a CHIEF / COMMAND
  // reviewer, so editing is allowed there regardless.
  const tierCanEdit = mode === 'reviewer' || ['COMMAND', 'CHIEF', 'HOD'].includes(tier);
  const canEdit = tierCanEdit && !!rota?.id && !loading && !error;
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
    snapshotRef.current = { rotaId: rota.id, deptId: footerDeptId, memberIds, rows: data || [] };
  }, [rota, footerDeptId, crew]);

  // Restore the dept to the snapshot: clear the current scope, reinsert the
  // captured rows (original ids preserved so any FK references survive). Also
  // clears any has_unpublished_changes flag raised during the discarded session
  // (editing a published dept sets it; a discard must unset it). No-op on
  // non-published depts.
  const restoreSnapshot = useCallback(async (snap) => {
    if (!snap?.rotaId) return;
    if (snap.memberIds?.length) {
      await supabase.from('rota_shifts').delete()
        .eq('rota_id', snap.rotaId).in('member_id', snap.memberIds);
      if (snap.rows.length) await supabase.from('rota_shifts').insert(snap.rows);
    }
    if (snap.deptId) {
      await supabase.rpc('mark_dept_unpublished_changes', {
        p_rota_id: snap.rotaId, p_department_id: snap.deptId, p_changed: false,
      }).then(() => {}).catch(() => {});
    }
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
      // Only pending_approval still reverts to draft on edit (pulling it from
      // review) — worth the warning. A published dept now stays published and
      // just flags "unpublished changes" (Model B), so no scary modal there.
      if (status === 'pending_approval') {
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
    crew: visibleCrew, total, onDuty, editMode, draftDayCount, editCount,
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
          <button
            type="button"
            className={`crew-rota-pill${view === 'hor' ? ' active' : ''}`}
            onClick={() => setView(view === 'hor' ? 'grid' : 'hor')}
            title={view === 'hor' ? 'Back to day view' : 'Hours of rest log'}
          >Hours of rest log</button>
        </div>
        <div className="crew-rota-divider" />
        <div className="crew-rota-stepper">
          <button
            type="button"
            className="crew-rota-stepper-btn is-active"
            aria-label={view === 'hor' ? (horPeriod === 'month' ? 'Previous month' : 'Previous week') : (view === 'week' ? 'Previous week' : 'Previous day')}
            title={view === 'hor' ? (horPeriod === 'month' ? 'Previous month' : 'Previous week') : (view === 'week' ? 'Previous week' : 'Previous day')}
            onClick={() => setSelectedDate((s) => (
              view === 'hor'
                ? (horPeriod === 'month' ? addLocalMonths(s, -1) : addLocalDays(s, -7))
                : addLocalDays(s, view === 'week' ? -7 : -1)
            ))}
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
                : view === 'hor' ? `Hours of rest log · ${hor.label}. Pick a date.` : undefined}
              title={view === 'hor' ? (horPeriod === 'month' ? 'Pick a month' : 'Pick a week start') : (view === 'week' ? 'Pick a week start' : 'Pick a date')}
            >
              <CalendarIcon size={13} />
              {view === 'hor'
                ? hor.label
                : view === 'week'
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
            aria-label={view === 'hor' ? (horPeriod === 'month' ? 'Next month' : 'Next week') : (view === 'week' ? 'Next week' : 'Next day')}
            title={view === 'hor' ? (horPeriod === 'month' ? 'Next month' : 'Next week') : (view === 'week' ? 'Next week' : 'Next day')}
            onClick={() => setSelectedDate((s) => (
              view === 'hor'
                ? (horPeriod === 'month' ? addLocalMonths(s, 1) : addLocalDays(s, 7))
                : addLocalDays(s, view === 'week' ? 7 : 1)
            ))}
          >→</button>
          {view !== 'week' && view !== 'hor' && (
            <span className="crew-rota-stepper-helper">
              click any name for the rest panel
            </span>
          )}
          {view === 'hor' && (
            <span className="crew-rota-stepper-helper">
              daily rest per crew · {horPeriod === 'month' ? 'calendar month' : '7-day week'}
            </span>
          )}
        </div>
      </div>

      {/* Body card with its own header / body / footer */}
      <div className={`crew-rota-card${editMode ? ' is-editing' : ''}`}>
        <div className="crew-rota-card-header">
          <div className="crew-rota-card-context">{cardContext}</div>
          <div className="crew-rota-pillgroup">
            {canFilterDepts && (
              <DepartmentFilter
                departments={presentDeptList}
                value={visibleDeptIds || new Set(presentDeptList.map((d) => d.id))}
                onChange={setVisibleDeptIds}
                ownId={ownDeptId}
              />
            )}
            {view === 'hor' ? (
              <>
                <button
                  type="button"
                  className={`crew-rota-pill${horPeriod === 'week' ? ' active' : ''}`}
                  onClick={() => setHorPeriod('week')}
                  title="Show one week"
                >Week</button>
                <button
                  type="button"
                  className={`crew-rota-pill${horPeriod === 'month' ? ' active' : ''}`}
                  onClick={() => setHorPeriod('month')}
                  title="Show the calendar month"
                >Month</button>
              </>
            ) : (
              <>
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
              </>
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
              crew={visibleCrew}
              windowShifts={windowShifts || []}
              workEntries={workEntries}
              selectedDate={selectedDate}
              realToday={realToday}
              gridStartHour={gridStartHour}
              onCellClick={(d) => { setSelectedDate(d); setView('grid'); }}
              onStepDay={(delta) => setSelectedDate((s) => addLocalDays(s, delta))}
            />
          ) : view === 'hor' ? (
            <RestLogView
              crew={visibleCrew}
              windowShifts={windowShifts || []}
              days={hor.days}
              period={horPeriod}
              realToday={realToday}
              vesselName={vesselName}
              imoNumber={vesselIdentity.imoNumber}
              flagState={vesselIdentity.flagState}
              portOfRegistry={vesselIdentity.portOfRegistry}
              periodLabel={hor.label}
              departmentName={departmentName}
              breachReasons={breachReasons}
              workEntries={workEntries}
              tenantId={activeTenantId}
              canSignOff={tierRank(tier) >= tierRank(horApproverTier)}
              onReasonsSaved={handleReasonsSaved}
              horDayBasis={horDayBasis}
              operationalDayStartHour={gridStartHour}
              onCellClick={(d) => { setSelectedDate(d); setView('grid'); }}
            />
          ) : visibleCrew.length === 0 ? (
            // Only a truly crew-less rota gets the bare message. A day with
            // crew but no shifts still renders the grid — empty cells are
            // paintable, so COMMAND/CHIEF/HOD can drag hours straight in
            // rather than hitting a dead-end one-liner.
            <div className="crew-rota-empty">
              <div className="crew-rota-empty-msg">No crew on this rota yet.</div>
            </div>
          ) : view === 'grid' ? (
            <RotaTodayGrid
              crew={visibleCrew}
              now={isToday ? now : null}
              gridStartHour={gridStartHour}
              onCrewClick={setSelectedCrew}
              editMode={editMode}
              onPaint={handlePaint}
              editableDeptIds={editableDeptIds}
              deptStatus={statusByDept}
              highlightSlots={highlightSlots}
              viewDate={selectedDate}
            />
          ) : (
            <CrewListView crew={visibleCrew} onCrewClick={setSelectedCrew} deptStatus={statusByDept} />
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

      <RestPanelPopover
        crew={selectedCrew}
        anchorDate={selectedDate}
        roster={crew}
        windowShifts={windowShifts || []}
        onClose={() => setSelectedCrew(null)}
        onViewSchedule={() => { setSelectedCrew(null); setView('grid'); }}
        onOpenHor={() => { setSelectedCrew(null); setView('hor'); }}
        onLogReason={() => openBreachNotes(selectedCrew)}
        onApplySuggestion={(sg) => setApplySuggestion({ suggestion: sg, sourceCrew: selectedCrew })}
      />

      {breachNotesFor && (
        <BreachNotesModal
          isOpen={!!breachNotesFor}
          breachedDates={breachNotesFor.breachedDates}
          userId={breachNotesFor.userId}
          currentUserId={currentUser?.id || user?.id}
          tenantId={activeTenantId}
          onClose={() => { setBreachNotesFor(null); setReasonsNonce((n) => n + 1); }}
        />
      )}

      <CoverageApplyModal
        open={!!applySuggestion}
        suggestion={applySuggestion?.suggestion}
        sourceCrew={applySuggestion?.sourceCrew}
        crew={crew}
        windowShifts={windowShifts || []}
        base={{
          tenantId: rota?.tenantId,
          rotaId: rota?.id,
          tripId: rota?.tripId || null,
          createdBy: myMemberId,
        }}
        ensureDraft={ensureDraft}
        applyTemplate={applyTemplate}
        publishImmediately={tier === 'COMMAND' || tier === 'CHIEF'}
        realToday={realToday}
        nowHHMM={`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`}
        onToast={showToast}
        onClose={() => setApplySuggestion(null)}
        onApplied={() => { setApplySuggestion(null); setSelectedCrew(null); refetch?.(); }}
      />
    </>
  );
}

// Re-exported so the /crew page header slot can label dates the same way the
// control bar does, without duplicating the helpers.
export { fullDateLabel, weekRangeLabel };

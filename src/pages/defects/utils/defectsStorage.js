// Defects data layer — Supabase-backed (was localStorage `cargo_defects_v1`).
//
// Every record lives in public.defects (tenant-scoped, RLS), so defects are
// shared across the vessel, notifications reach other crew's devices, and a
// fleet snag report / survey audit trail is possible. Comments live in
// public.defect_comments; an immutable audit trail in public.defect_events.
//
// Identity is the real Supabase login/tenant model — NOT the localStorage user
// cache. Callers pass an `actor` context resolved from useAuth()/useTenant():
//   actor = { tenantId, userId, userName, tier, departmentId, departmentName }
// Writes attribute to actor.userId (an auth uid), and every uid is stored beside
// a denormalised *_name so display survives even when a uid can't be resolved.
//
// All functions are async (Promise-returning). Row shapes are mapped to the same
// camelCase fields the existing UI already reads, so callers change only by
// awaiting + passing `actor`.

import { supabase } from '../../../lib/supabaseClient';
import { logActivity, DefectActions } from '../../../utils/activityStorage';
import { getAllDecks, getZonesByDeck, getSpacesByZone } from '../../locations-management-settings/utils/locationsHierarchyStorage';
import {
  notifyChiefsPendingDefect,
  notifyChiefsNewDefect,
  notifyChiefsQuoteApproval,
  notifyRequesterApprovalDecision,
  notifySenderAccepted,
  notifySenderDeclined,
  notifyDefectAssigned,
  notifyDefectWatchers,
} from './defectsNotifications';

// ── Enums (unchanged public API) ─────────────────────────────────────────────
export const normalizeDept = (dept) => (dept || '')?.trim()?.toUpperCase();

export const DefectStatus = {
  PENDING_ACCEPTANCE: 'pending_acceptance',
  NEW: 'New',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'InProgress',
  WAITING_PARTS: 'WaitingParts',
  FIXED: 'Fixed',
  CLOSED: 'Closed',
  DECLINED: 'declined',
  REOPENED: 'Reopened',
};

export const DefectPriority = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', CRITICAL: 'Critical' };

// Repair works stage — the external-contractor progression, distinct from the
// internal defect status. Ordered; app-validated (column is free text).
export const RepairStage = {
  NOT_STARTED: 'not_started', CONTACTED: 'contacted', QUOTING: 'quoting',
  QUOTED: 'quoted', SCHEDULED: 'scheduled', IN_PROGRESS: 'in_progress', COMPLETED: 'completed',
};
export const REPAIR_STAGE_ORDER = ['contacted', 'quoting', 'quoted', 'scheduled', 'in_progress', 'completed'];
export const REPAIR_STAGE_LABELS = {
  not_started: 'Not started', contacted: 'Contractor contacted', quoting: 'Awaiting quote',
  quoted: 'Quote received', scheduled: 'Scheduled', in_progress: 'In progress', completed: 'Complete',
};
// A quote at/above this (in the quote's own currency) auto-requires a Captain/HOD
// sign-off before the repair can be scheduled.
export const QUOTE_APPROVAL_THRESHOLD = 1000;
export const QuoteApproval = { PENDING: 'pending', APPROVED: 'approved', DECLINED: 'declined' };

export const DefectDepartment = {
  INTERIOR: 'Interior', DECK: 'Deck', ENGINEERING: 'Engineering', GALLEY: 'Galley', MANAGEMENT: 'Management',
};

// ── Tier helpers (work off the actor.tier string, an auth/tenant permission tier)
const isCommandTier = (t) => normalizeDept(t) === 'COMMAND';
const isChiefTier = (t) => normalizeDept(t) === 'CHIEF';
const isHODTier = (t) => normalizeDept(t) === 'HOD';

// ── Location label (legacy deck/zone/space hierarchy is still localStorage) ───
export const buildLocationPathLabel = (deckId, zoneId, spaceId) => {
  const decks = getAllDecks(false);
  const deck = decks?.find((d) => d?.id === deckId);
  if (!deck) return '';
  const zones = getZonesByDeck(deckId, false);
  const zone = zones?.find((z) => z?.id === zoneId);
  if (!zone) return deck?.name;
  if (!spaceId) return `${deck?.name} > ${zone?.name}`;
  const spaces = getSpacesByZone(zoneId, false);
  const space = spaces?.find((s) => s?.id === spaceId);
  if (!space) return `${deck?.name} > ${zone?.name}`;
  return `${deck?.name} > ${zone?.name} > ${space?.name}`;
};

// ── Real tenant departments (id + name) for the target-department picker ──────
export const fetchTenantDepartments = async (tenantId) => {
  if (!tenantId) return [];
  const { data, error } = await supabase?.rpc('get_tenant_departments', { p_tenant_id: tenantId });
  if (!error && Array.isArray(data) && data.length) return data;
  // Fallback: collect from tenant_members → departments (RLS-safe id list)
  const { data: memberDepts } = await supabase
    ?.from('tenant_members')?.select('department_id')?.eq('tenant_id', tenantId)?.not('department_id', 'is', null) || {};
  const ids = [...new Set((memberDepts || []).map((m) => m?.department_id).filter(Boolean))];
  if (!ids.length) return [];
  const { data: rows } = await supabase?.from('departments')?.select('id, name')?.in('id', ids)?.order('name', { ascending: true }) || {};
  return rows || [];
};

// Resolve the auth uids of everyone in a department (for team notify / assign).
export const resolveDepartmentMemberIds = async (tenantId, departmentId) => {
  if (!tenantId || !departmentId) return [];
  const { data, error } = await supabase?.rpc('get_tenant_members_for_jobs', {
    p_tenant_id: tenantId, p_department_id: departmentId,
  });
  if (error || !Array.isArray(data)) return [];
  return data.map((m) => ({ userId: m?.user_id, tier: m?.permission_tier })).filter((m) => m.userId);
};

// ── Row mapping (snake_case DB row → camelCase the UI expects) ────────────────
const fromRow = (r) => {
  if (!r) return null;
  return {
    id: r.id,
    seq: r.seq,
    ref: r.seq != null ? `DEF-${String(r.seq).padStart(4, '0')}` : null,
    title: r.title,
    description: r.description || '',
    priority: r.priority,
    status: r.status,
    departmentId: r.department_id,
    departmentOwner: r.department_owner,
    targetDepartment: r.department_owner,
    reportedByUserId: r.reported_by,
    reportedByName: r.reported_by_name,
    createdByUserId: r.created_by,
    createdByName: r.created_by_name,
    createdByDepartment: r.created_by_department,
    createdByTier: r.created_by_tier,
    assigneeKind: r.assignee_kind,
    assignedToUserId: r.assigned_to,
    assignedToName: r.assigned_to_name,
    assignedTeamDepartmentId: r.assigned_team_department_id,
    assignedTeamName: r.assigned_team_name,
    claimedByUserId: r.claimed_by,
    claimedByName: r.claimed_by_name,
    claimedAt: r.claimed_at,
    pendingForDepartment: r.pending_for_department,
    sentForAcceptance: r.sent_for_acceptance,
    submittedByUserId: r.submitted_by,
    submittedByName: r.submitted_by_name,
    decidedByUserId: r.decided_by,
    decidedAt: r.decided_at,
    decisionNotes: r.decision_notes,
    dueDate: r.due_date,
    contractorName: r.contractor_name,
    contractorDetails: r.contractor_details,
    contractorSupplierId: r.contractor_supplier_id,
    contractorContactName: r.contractor_contact_name,
    contractorEmail: r.contractor_email,
    contractorPhone: r.contractor_phone,
    scheduledEndAt: r.scheduled_end_at,
    repairStage: r.repair_stage,
    warrantyUntil: r.warranty_until,
    quoteApprovalStatus: r.quote_approval_status,
    quoteApprovedByName: r.quote_approved_by_name,
    quoteApprovedAt: r.quote_approved_at,
    quoteApprovalNote: r.quote_approval_note,
    scheduledFixAt: r.scheduled_fix_at,
    closedAt: r.closed_at,
    closedByUserId: r.closed_by,
    closedByName: r.closed_by_name,
    closedNotes: r.closed_notes,
    closedPhoto: r.closed_photo,
    reopenedAt: r.reopened_at,
    reopenedByUserId: r.reopened_by,
    reopenedByName: r.reopened_by_name,
    reopenedNotes: r.reopened_notes,
    defectType: r.defect_type,
    defectSubType: r.defect_sub_type,
    affectsGuestAreas: r.affects_guest_areas,
    safetyRelated: r.safety_related,
    locationDeckId: r.location_deck_id,
    locationZoneId: r.location_zone_id,
    locationSpaceId: r.location_space_id,
    locationPathLabel: r.location_path_label,
    locationFreeText: r.location_free_text,
    hotspotId: r.hotspot_id,
    locationNodeId: r.location_node_id,
    photos: Array.isArray(r.photos) ? r.photos : [],
    notifyUsers: Array.isArray(r.notify_user_ids) ? r.notify_user_ids : [],
    isArchivedBySender: r.is_archived_by_sender,
    archivedAt: r.archived_at,
    deletedAt: r.deleted_at,
    deletedByUserId: r.deleted_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
};

// Write an audit-trail row (best-effort; never blocks the primary write).
const logEvent = async (actor, defectId, type, summary, meta = {}) => {
  if (!actor?.tenantId || !defectId) return;
  await supabase?.from('defect_events')?.insert({
    defect_id: defectId,
    tenant_id: actor.tenantId,
    type,
    actor_id: actor.userId || null,
    actor_name: actor.userName || null,
    summary: summary || null,
    meta,
  });
};

// ── Create ───────────────────────────────────────────────────────────────────
export const createDefect = async (defectData, actor) => {
  if (!actor?.tenantId) throw new Error('No active vessel — cannot create a defect.');

  const locationPathLabel = defectData?.locationPathLabel
    || buildLocationPathLabel(defectData?.locationDeckId, defectData?.locationZoneId, defectData?.locationSpaceId);

  const tier = normalizeDept(actor.tier);
  const targetDeptName = defectData?.departmentOwner || actor.departmentName || null;
  const createdByDept = actor.departmentName || null;

  // Pending-acceptance gate (same rules as before, now on the actor's real tier):
  //   COMMAND → open; CHIEF → open same-dept / pending cross-dept;
  //   HOD → open (own dept); CREW → pending (own dept).
  let requiresPending = false;
  let status = DefectStatus.NEW;
  let pendingForDept = null;
  if (isCommandTier(tier)) {
    requiresPending = false;
  } else if (isChiefTier(tier)) {
    if (normalizeDept(targetDeptName) !== normalizeDept(createdByDept)) {
      requiresPending = true; status = DefectStatus.PENDING_ACCEPTANCE; pendingForDept = normalizeDept(targetDeptName);
    }
  } else if (isHODTier(tier)) {
    requiresPending = false;
  } else {
    requiresPending = true; status = DefectStatus.PENDING_ACCEPTANCE; pendingForDept = normalizeDept(createdByDept);
  }

  // Resolve the target department id (needed to notify its chiefs / assign a team).
  let targetDeptId = defectData?.departmentId || null;
  if (!targetDeptId && targetDeptName) {
    const depts = await fetchTenantDepartments(actor.tenantId);
    targetDeptId = depts.find((d) => normalizeDept(d?.name) === normalizeDept(targetDeptName))?.id || null;
  }

  const assignedTo = defectData?.assignedToUserId || null;
  // Assignment: a named person, the whole department team (first to claim owns
  // it), or unassigned.
  const kind = defectData?.assigneeKind || (assignedTo ? 'user' : 'unassigned');
  const teamDeptId = kind === 'team' ? (defectData?.assignedTeamDepartmentId || targetDeptId) : null;

  const insertRow = {
    tenant_id: actor.tenantId,
    title: defectData?.title?.trim(),
    description: defectData?.description?.trim() || '',
    priority: defectData?.priority || DefectPriority.MEDIUM,
    status,
    department_id: targetDeptId,
    department_owner: targetDeptName,
    reported_by: actor.userId || null,
    reported_by_name: actor.userName || null,
    created_by: actor.userId || null,
    created_by_name: actor.userName || null,
    created_by_department: createdByDept,
    created_by_tier: tier,
    assignee_kind: kind,
    assigned_to: kind === 'user' ? assignedTo : null,
    assigned_to_name: kind === 'user' ? (defectData?.assignedToName || null) : null,
    assigned_team_department_id: teamDeptId,
    assigned_team_name: kind === 'team' ? (defectData?.assignedTeamName || targetDeptName) : null,
    submitted_by: requiresPending ? actor.userId || null : null,
    submitted_by_name: requiresPending ? actor.userName || null : null,
    pending_for_department: pendingForDept,
    sent_for_acceptance: requiresPending,
    due_date: defectData?.dueDate || null,
    defect_type: defectData?.defectType || null,
    defect_sub_type: defectData?.defectSubType || null,
    affects_guest_areas: !!defectData?.affectsGuestAreas,
    safety_related: !!defectData?.safetyRelated,
    location_deck_id: defectData?.locationDeckId || null,
    location_zone_id: defectData?.locationZoneId || null,
    location_space_id: defectData?.locationSpaceId || null,
    location_path_label: locationPathLabel || null,
    location_free_text: defectData?.locationFreeText || '',
    hotspot_id: defectData?.hotspotId || null,
    location_node_id: defectData?.locationNodeId || null,
    photos: Array.isArray(defectData?.photos) ? defectData.photos : [],
    notify_user_ids: Array.isArray(defectData?.notifyUsers) ? defectData.notifyUsers : [],
  };

  const { data, error } = await supabase?.from('defects')?.insert(insertRow)?.select('*')?.single();
  if (error) throw error;
  const defect = fromRow(data);

  await logEvent(actor, defect.id, 'created', requiresPending ? `Awaiting acceptance: ${defect.title}` : `Logged: ${defect.title}`, {
    priority: defect.priority, location: locationPathLabel,
  });

  // Activity feed (legacy) — best-effort.
  try {
    logActivity({
      module: 'defects',
      action: requiresPending ? 'DEFECT_PENDING_ACCEPTANCE' : DefectActions?.DEFECT_CREATED,
      entityType: 'defect', entityId: defect.id,
      departmentScope: normalizeDept(defect.departmentOwner),
      summary: requiresPending ? `Defect awaiting acceptance: ${defect.title}` : `Created defect: ${defect.title}`,
      meta: { priority: defect.priority, location: locationPathLabel },
    });
  } catch { /* non-fatal */ }

  // Cross-device notifications.
  if (requiresPending) {
    await notifyChiefsPendingDefect(actor, targetDeptId, defect.title, defect.id);
  } else {
    await notifyChiefsNewDefect(actor, targetDeptId, defect.title, defect.id);
    if (kind === 'user' && assignedTo) {
      await notifyDefectAssigned(actor, [assignedTo], defect.title, defect.id, defect.dueDate);
    } else if (kind === 'team' && teamDeptId) {
      const members = await resolveDepartmentMemberIds(actor.tenantId, teamDeptId);
      await notifyDefectAssigned(actor, members.map((m) => m.userId), defect.title, defect.id, defect.dueDate);
    }
    // Extra "also notify" watchers (e.g. the Chief Stew on an Engineering defect).
    const watchers = (insertRow.notify_user_ids || []).map((w) => w?.id).filter(Boolean);
    if (watchers.length) await notifyDefectWatchers(actor, watchers, defect.title, defect.id);
  }

  return defect;
};

// Resolve the scan a hotspot belongs to — for building a "View on map" deep link
// (/vessel/map?scan=<scanId>&pin=<hotspotId>).
export const getHotspotScanId = async (hotspotId) => {
  if (!hotspotId) return null;
  const { data, error } = await supabase?.from('scan_hotspots')?.select('scan_id')?.eq('id', hotspotId)?.maybeSingle();
  if (error) { console.warn('[defects] getHotspotScanId', error); return null; }
  return data?.scan_id || null;
};

// Fetch the active (non-closed) defect linked to a map pin, if any.
export const getDefectByHotspot = async (hotspotId, actor) => {
  if (!hotspotId || !actor?.tenantId) return null;
  const { data, error } = await supabase
    ?.from('defects')?.select('*')
    ?.eq('tenant_id', actor.tenantId)?.eq('hotspot_id', hotspotId)
    ?.neq('status', DefectStatus.CLOSED)
    ?.order('created_at', { ascending: false })?.limit(1);
  if (error) { console.warn('[defects] getDefectByHotspot', error); return null; }
  return data && data.length ? fromRow(data[0]) : null;
};

// Assign a defect to a named person or a whole team, notifying recipients.
// Prior repairs at this defect's location that are still under warranty — a
// possible warranty claim if the fault has recurred. Excludes this defect.
export const fetchWarrantyContext = async (defect, actor) => {
  if (!defect?.locationNodeId || !actor?.tenantId) return [];
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = (await supabase
    ?.from('defects')
    ?.select('id, seq, title, warranty_until, contractor_name')
    ?.eq('tenant_id', actor.tenantId)
    ?.eq('location_node_id', defect.locationNodeId)
    ?.gte('warranty_until', today)
    ?.neq('id', defect.id)
    ?.order('warranty_until', { ascending: false })) || {};
  if (error) { console.warn('[defects] fetchWarrantyContext', error); return []; }
  return (data || []).map((r) => ({
    id: r.id, ref: r.seq != null ? `DEF-${String(r.seq).padStart(4, '0')}` : '',
    title: r.title, warrantyUntil: r.warranty_until, contractorName: r.contractor_name,
  }));
};

// Who can sign off a repair quote is configurable per vessel
// (vessels.defect_quote_approver_tier, default 'HOD' = HOD & above). Hierarchical:
// an equal-or-higher tier than the required one may approve.
const TIER_RANK = { COMMAND: 4, CHIEF: 3, HOD: 2, CREW: 1 };
export const canApproveQuote = (actor, approverTier = 'HOD') =>
  (TIER_RANK[normalizeDept(actor?.tier)] || 0) >= (TIER_RANK[normalizeDept(approverTier)] || 2);

// Per-vessel sign-off config (approver tier + auto-request threshold).
export const fetchDefectQuoteSettings = async (tenantId) => {
  const fallback = { approverTier: 'HOD', threshold: QUOTE_APPROVAL_THRESHOLD };
  if (!tenantId) return fallback;
  const { data, error } = (await supabase
    ?.from('vessels')?.select('defect_quote_approver_tier, defect_quote_signoff_threshold')
    ?.eq('tenant_id', tenantId)?.maybeSingle()) || {};
  if (error || !data) return fallback;
  return {
    approverTier: data.defect_quote_approver_tier || 'HOD',
    threshold: data.defect_quote_signoff_threshold != null ? Number(data.defect_quote_signoff_threshold) : QUOTE_APPROVAL_THRESHOLD,
  };
};

// Ask a Captain/HOD to sign off the repair quote before it's scheduled.
export const requestQuoteApproval = async (defectId, actor, amountLabel = null) => {
  if (!defectId || !actor?.tenantId) return null;
  const before = await getDefectById(defectId, actor);
  if (!before) return null;
  const { data, error } = await supabase
    ?.from('defects')?.update({
      quote_approval_status: 'pending',
      quote_approved_by: null, quote_approved_by_name: null, quote_approved_at: null, quote_approval_note: null,
    })?.eq('id', defectId)?.eq('tenant_id', actor.tenantId)?.select('*')?.single();
  if (error) { console.warn('[defects] requestQuoteApproval', error); return null; }
  await logEvent(actor, defectId, 'approval_requested', `Quote sign-off requested${amountLabel ? ` (${amountLabel})` : ''}`);
  await notifyChiefsQuoteApproval(actor, before.departmentId, before.title, defectId, amountLabel);
  return fromRow(data);
};

// Approve/decline the quote. Authority is enforced server-side by the RPC
// (tier vs vessels.defect_quote_approver_tier); the client gate just hides the
// buttons. Event + notifications are written here after the decision lands.
export const decideQuoteApproval = async (defectId, approved, note, actor) => {
  if (!defectId || !actor?.tenantId) return null;
  const before = await getDefectById(defectId, actor);
  if (!before) return null;
  const { data, error } = (await supabase?.rpc('defect_decide_quote_approval', {
    p_defect_id: defectId, p_approved: approved, p_note: note || null,
  })) || {};
  if (error || !data) { console.warn('[defects] decideQuoteApproval', error); return null; }
  await logEvent(actor, defectId, 'approval_decided',
    `${approved ? 'Quote approved' : 'Quote declined'}${note ? ` — ${note}` : ''}`);
  const recipients = [...new Set([before.reportedByUserId, before.assignedToUserId].filter(Boolean))];
  await Promise.all(recipients.map((uid) => notifyRequesterApprovalDecision(actor, uid, before.title, defectId, approved)));
  return fromRow(Array.isArray(data) ? data[0] : data);
};

export const assignDefect = async (defectId, assignment, actor) => {
  if (!defectId || !actor?.tenantId) return null;
  const kind = assignment?.kind || 'unassigned';
  const patch = {
    assignee_kind: kind,
    assigned_to: kind === 'user' ? (assignment?.userId || null) : null,
    assigned_to_name: kind === 'user' ? (assignment?.userName || null) : null,
    assigned_team_department_id: kind === 'team' ? (assignment?.teamDepartmentId || null) : null,
    assigned_team_name: kind === 'team' ? (assignment?.teamName || null) : null,
    claimed_by: null, claimed_by_name: null, claimed_at: null,
  };
  const { data, error } = await supabase
    ?.from('defects')?.update(patch)?.eq('id', defectId)?.eq('tenant_id', actor.tenantId)?.select('*')?.single();
  if (error) { console.warn('[defects] assignDefect', error); return null; }
  const after = fromRow(data);
  if (kind === 'user' && assignment?.userId) {
    await logEvent(actor, defectId, 'assigned', `Assigned to ${assignment?.userName || 'crew'}`);
    await notifyDefectAssigned(actor, [assignment.userId], after.title, defectId, after.dueDate);
  } else if (kind === 'team' && assignment?.teamDepartmentId) {
    await logEvent(actor, defectId, 'assigned', `Assigned to ${assignment?.teamName || 'the team'}`);
    const members = await resolveDepartmentMemberIds(actor.tenantId, assignment.teamDepartmentId);
    await notifyDefectAssigned(actor, members.map((m) => m.userId), after.title, defectId, after.dueDate);
  }
  return after;
};

// Team claim — first crew member to accept a team defect owns it.
export const claimDefect = async (defectId, actor) => {
  if (!defectId || !actor?.tenantId || !actor?.userId) return null;
  const before = await getDefectById(defectId, actor);
  if (!before) return null;
  const { data, error } = await supabase?.from('defects')?.update({
    assignee_kind: 'user',
    assigned_to: actor.userId,
    assigned_to_name: actor.userName || null,
    claimed_by: actor.userId,
    claimed_by_name: actor.userName || null,
    claimed_at: new Date().toISOString(),
    status: before.status === DefectStatus.NEW ? DefectStatus.ASSIGNED : before.status,
  })?.eq('id', defectId)?.eq('tenant_id', actor.tenantId)?.select('*')?.single();
  if (error) { console.warn('[defects] claimDefect', error); return null; }
  await logEvent(actor, defectId, 'claimed', `${actor.userName || 'A crew member'} claimed it`);
  return fromRow(data);
};

// ── Reads ─────────────────────────────────────────────────────────────────────
// Returns ALL defects for the tenant (RLS scopes to the tenant). Permission /
// department scoping for the UI is applied by the caller, as before.
export const getAllDefects = async (actor) => {
  if (!actor?.tenantId) return [];
  const { data, error } = await supabase
    ?.from('defects')?.select('*')?.eq('tenant_id', actor.tenantId)?.order('created_at', { ascending: false });
  if (error) { console.warn('[defects] getAllDefects', error); return []; }
  return (data || []).map(fromRow);
};

export const getDefectById = async (defectId, actor) => {
  if (!defectId) return null;
  let q = supabase?.from('defects')?.select('*')?.eq('id', defectId);
  if (actor?.tenantId) q = q?.eq('tenant_id', actor.tenantId);
  const { data, error } = await q?.maybeSingle();
  if (error) { console.warn('[defects] getDefectById', error); return null; }
  return fromRow(data);
};

// Comments + events for a single defect (detail view).
export const getDefectComments = async (defectId) => {
  if (!defectId) return [];
  const { data, error } = await supabase
    ?.from('defect_comments')?.select('*')?.eq('defect_id', defectId)?.order('created_at', { ascending: true });
  if (error) return [];
  return (data || []).map((c) => ({ id: c.id, userId: c.user_id, userName: c.user_name, text: c.body, createdAt: c.created_at }));
};

export const getDefectEvents = async (defectId) => {
  if (!defectId) return [];
  const { data, error } = await supabase
    ?.from('defect_events')?.select('*')?.eq('defect_id', defectId)?.order('created_at', { ascending: false });
  if (error) return [];
  return data || [];
};

// ── Generic update ────────────────────────────────────────────────────────────
const UPDATE_FIELD_MAP = {
  title: 'title', description: 'description', priority: 'priority', status: 'status',
  dueDate: 'due_date', departmentOwner: 'department_owner', departmentId: 'department_id',
  assignedToUserId: 'assigned_to', assignedToName: 'assigned_to_name', assigneeKind: 'assignee_kind',
  assignedTeamDepartmentId: 'assigned_team_department_id', assignedTeamName: 'assigned_team_name',
  defectType: 'defect_type', defectSubType: 'defect_sub_type',
  affectsGuestAreas: 'affects_guest_areas', safetyRelated: 'safety_related',
  locationPathLabel: 'location_path_label', locationFreeText: 'location_free_text',
  hotspotId: 'hotspot_id', locationNodeId: 'location_node_id',
  photos: 'photos', notifyUsers: 'notify_user_ids',
  contractorName: 'contractor_name', contractorDetails: 'contractor_details', scheduledFixAt: 'scheduled_fix_at',
  contractorSupplierId: 'contractor_supplier_id', scheduledEndAt: 'scheduled_end_at',
  contractorContactName: 'contractor_contact_name', contractorEmail: 'contractor_email', contractorPhone: 'contractor_phone',
  repairStage: 'repair_stage', warrantyUntil: 'warranty_until',
};
const EDIT_FIELDS = ['title', 'description', 'priority', 'dueDate', 'departmentOwner', 'contractorName', 'contractorDetails', 'scheduledFixAt'];

export const updateDefect = async (defectId, updates, actor) => {
  if (!defectId || !actor?.tenantId) return null;
  const before = await getDefectById(defectId, actor);
  if (!before) return null;

  const patch = {};
  Object.entries(updates || {}).forEach(([k, v]) => {
    if (UPDATE_FIELD_MAP[k]) patch[UPDATE_FIELD_MAP[k]] = v;
  });
  if (updates?.status === DefectStatus.CLOSED && !before.closedAt) patch.closed_at = new Date().toISOString();

  const { data, error } = await supabase
    ?.from('defects')?.update(patch)?.eq('id', defectId)?.eq('tenant_id', actor.tenantId)?.select('*')?.single();
  if (error) { console.warn('[defects] updateDefect', error); return null; }
  const after = fromRow(data);

  if (updates?.status && updates.status !== before.status) {
    await logEvent(actor, defectId, 'status_changed', `Status ${before.status} → ${updates.status}`, {
      statusFrom: before.status, statusTo: updates.status,
    });
  }
  if (updates?.assignedToUserId && updates.assignedToUserId !== before.assignedToUserId) {
    await logEvent(actor, defectId, 'assigned', `Assigned to ${updates.assignedToName || 'crew'}`, { assignedTo: updates.assignedToUserId });
    await notifyDefectAssigned(actor, [updates.assignedToUserId], after.title, defectId, after.dueDate);
  }
  if (updates?.repairStage && updates.repairStage !== before.repairStage) {
    await logEvent(actor, defectId, 'repair_stage', `Repair: ${REPAIR_STAGE_LABELS[updates.repairStage] || updates.repairStage}`, {
      stageFrom: before.repairStage || null, stageTo: updates.repairStage,
    });
  }
  // Content edit (title/priority/dates/contractor/etc.) — one audit entry.
  if (EDIT_FIELDS.some((f) => f in (updates || {}))) {
    const bits = [];
    if (updates.contractorName && updates.contractorName !== before.contractorName) bits.push(`contractor ${updates.contractorName}`);
    if (updates.scheduledFixAt && updates.scheduledFixAt !== before.scheduledFixAt) bits.push('fix scheduled');
    await logEvent(actor, defectId, 'edited', bits.length ? `Updated — ${bits.join(', ')}` : 'Updated the defect');
  }
  return after;
};

// ── Comments / photos ─────────────────────────────────────────────────────────
export const addDefectComment = async (defectId, text, actor) => {
  if (!defectId || !text?.trim() || !actor?.tenantId) return null;
  const { error } = await supabase?.from('defect_comments')?.insert({
    defect_id: defectId, tenant_id: actor.tenantId, user_id: actor.userId || null,
    user_name: actor.userName || null, body: text.trim(),
  });
  if (error) { console.warn('[defects] addDefectComment', error); return null; }
  await supabase?.from('defects')?.update({ updated_at: new Date().toISOString() })?.eq('id', defectId)?.eq('tenant_id', actor.tenantId);
  await logEvent(actor, defectId, 'comment', 'Added a comment');
  return getDefectById(defectId, actor);
};

export const addDefectPhoto = async (defectId, photoDataUrlOrPath, actor) => {
  if (!defectId || !photoDataUrlOrPath || !actor?.tenantId) return null;
  const current = await getDefectById(defectId, actor);
  if (!current) return null;
  // Store the raw data-url/path string so the carousel (which renders
  // photos[i] directly as an <img src>) works for every photo.
  const photos = [...(current.photos || []), photoDataUrlOrPath];
  const { error } = await supabase?.from('defects')?.update({ photos })?.eq('id', defectId)?.eq('tenant_id', actor.tenantId);
  if (error) { console.warn('[defects] addDefectPhoto', error); return null; }
  await logEvent(actor, defectId, 'photo', 'Added a photo');
  return getDefectById(defectId, actor);
};

// ── Acceptance flow ────────────────────────────────────────────────────────────
export const getPendingDefectsForChief = async (actor) => {
  if (!actor?.tenantId) return [];
  const tier = normalizeDept(actor.tier);
  if (tier !== 'CHIEF' && tier !== 'COMMAND') return [];
  const all = await getAllDefects(actor);
  const dept = normalizeDept(actor.departmentName);
  return all.filter((d) => {
    if (d.status !== DefectStatus.PENDING_ACCEPTANCE) return false;
    if (tier === 'COMMAND') return true;
    return normalizeDept(d.pendingForDepartment) === dept;
  });
};

export const acceptDefect = async (defectId, notes = '', actor) => {
  if (!defectId || !actor?.tenantId) return null;
  const before = await getDefectById(defectId, actor);
  if (!before) return null;
  const { data, error } = await supabase?.from('defects')?.update({
    status: DefectStatus.NEW, decided_by: actor.userId || null, decided_at: new Date().toISOString(),
    decision_notes: notes || null, pending_for_department: null,
  })?.eq('id', defectId)?.eq('tenant_id', actor.tenantId)?.select('*')?.single();
  if (error) { console.warn('[defects] acceptDefect', error); return null; }
  await logEvent(actor, defectId, 'accepted', `Accepted: ${before.title}`, { notes });
  if (before.createdByUserId) await notifySenderAccepted(actor, before.createdByUserId, before.title, defectId);
  return fromRow(data);
};

export const declineDefect = async (defectId, reason, actor) => {
  if (!defectId || !actor?.tenantId) return null;
  const before = await getDefectById(defectId, actor);
  if (!before) return null;
  const { data, error } = await supabase?.from('defects')?.update({
    status: DefectStatus.DECLINED, decided_by: actor.userId || null, decided_at: new Date().toISOString(),
    decision_notes: reason || null, pending_for_department: null,
  })?.eq('id', defectId)?.eq('tenant_id', actor.tenantId)?.select('*')?.single();
  if (error) { console.warn('[defects] declineDefect', error); return null; }
  await logEvent(actor, defectId, 'declined', `Declined: ${before.title}`, { reason });
  if (before.createdByUserId) await notifySenderDeclined(actor, before.createdByUserId, before.title, defectId, reason);
  return fromRow(data);
};

export const deletePendingDefect = async (defectId, actor) => {
  if (!defectId || !actor?.tenantId) return null;
  const before = await getDefectById(defectId, actor);
  if (!before || before.createdByUserId !== actor.userId || before.status !== DefectStatus.PENDING_ACCEPTANCE) return null;
  const { error } = await supabase?.from('defects')?.delete()?.eq('id', defectId)?.eq('tenant_id', actor.tenantId);
  if (error) { console.warn('[defects] deletePendingDefect', error); return null; }
  return { id: defectId, deleted: true };
};

export const archiveDeclinedDefect = async (defectId, actor) => {
  if (!defectId || !actor?.tenantId) return null;
  const before = await getDefectById(defectId, actor);
  if (!before || before.createdByUserId !== actor.userId || before.status !== DefectStatus.DECLINED) return null;
  const { data, error } = await supabase?.from('defects')?.update({
    is_archived_by_sender: true, archived_at: new Date().toISOString(),
  })?.eq('id', defectId)?.eq('tenant_id', actor.tenantId)?.select('*')?.single();
  if (error) { console.warn('[defects] archiveDeclinedDefect', error); return null; }
  return fromRow(data);
};

export const getSentByYouDefects = async (actor) => {
  if (!actor?.tenantId || !actor?.userId) return [];
  const all = await getAllDefects(actor);
  return all.filter((d) => d.createdByUserId === actor.userId
    && (d.status === DefectStatus.PENDING_ACCEPTANCE || d.status === DefectStatus.DECLINED));
};

// ── Close / reopen ──────────────────────────────────────────────────────────
export const closeDefectWithNotes = async (defectId, closeNotes, closePhoto = null, actor) => {
  if (!defectId || !actor?.tenantId) return null;
  const before = await getDefectById(defectId, actor);
  if (!before) return null;
  const { data, error } = await supabase?.from('defects')?.update({
    status: DefectStatus.CLOSED, closed_at: new Date().toISOString(),
    closed_by: actor.userId || null, closed_by_name: actor.userName || null,
    closed_notes: closeNotes || null, closed_photo: closePhoto || null,
  })?.eq('id', defectId)?.eq('tenant_id', actor.tenantId)?.select('*')?.single();
  if (error) { console.warn('[defects] closeDefect', error); return null; }
  await logEvent(actor, defectId, 'closed', `Closed: ${before.title}`, { hasPhoto: !!closePhoto });
  return fromRow(data);
};

export const reopenDefect = async (defectId, reopenNotes, actor) => {
  if (!defectId || !actor?.tenantId) return null;
  const before = await getDefectById(defectId, actor);
  if (!before) return null;
  const { data, error } = await supabase?.from('defects')?.update({
    status: DefectStatus.REOPENED, reopened_at: new Date().toISOString(),
    reopened_by: actor.userId || null, reopened_by_name: actor.userName || null,
    reopened_notes: reopenNotes || null,
  })?.eq('id', defectId)?.eq('tenant_id', actor.tenantId)?.select('*')?.single();
  if (error) { console.warn('[defects] reopenDefect', error); return null; }
  await logEvent(actor, defectId, 'reopened', `Re-opened: ${before.title}`, { notes: reopenNotes });
  return fromRow(data);
};

// ── Count helpers (pure — computed over an already-loaded list) ───────────────
const scopeToDept = (defects, actor) => {
  if (isCommandTier(actor?.tier)) return defects;
  const dept = normalizeDept(actor?.departmentName);
  return (defects || []).filter((d) => normalizeDept(d?.departmentOwner) === dept);
};
export const getOpenDefectsCount = (defects, actor) =>
  scopeToDept(defects, actor).filter((d) => d?.status !== DefectStatus.CLOSED).length;
export const getOverdueDefectsCount = (defects, actor) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return scopeToDept(defects, actor).filter((d) => d?.status !== DefectStatus.CLOSED && d?.dueDate && new Date(d.dueDate) < today).length;
};
export const getCriticalDefectsCount = (defects, actor) =>
  scopeToDept(defects, actor).filter((d) => d?.priority === DefectPriority.CRITICAL && d?.status !== DefectStatus.CLOSED).length;

// ── Permission helpers (accept the actor ctx { tier, departmentName }) ────────
const ctxTier = (u) => normalizeDept(u?.tier || u?.effectiveTier || u?.roleTier || u?.permissionTier);
const ctxDept = (u) => normalizeDept(u?.departmentName || u?.department);
export const canEditDefect = (u, defect) => {
  if (!u || !defect) return false;
  if (ctxTier(u) === 'COMMAND') return true;
  const t = ctxTier(u);
  return (t === 'CHIEF' || t === 'HOD') && ctxDept(u) === normalizeDept(defect?.departmentOwner);
};
export const canAssignDefect = (u, defect) => canEditDefect(u, defect);
export const canChangeDefectStatus = (u, defect) => canEditDefect(u, defect);
export const canCloseDefect = (u, defect) => canEditDefect(u, defect);
export const canAddCommentOrPhoto = () => true;

// ── One-time migration: legacy per-browser defects → the shared DB ────────────
// The old store was localStorage['cargo_defects_v1'] (per browser). On first load
// after this ships, any defects found there are inserted into public.defects for
// the active tenant, then the key is cleared so it never re-imports. Legacy user
// ids were localStorage ids (not auth uids), so uids are dropped and only the
// denormalised *_name text is carried across — display survives, attribution is
// best-effort.
const LEGACY_KEY = 'cargo_defects_v1';

export const importLegacyDefects = async (actor) => {
  if (!actor?.tenantId || typeof window === 'undefined') return;
  let legacy = [];
  try {
    const raw = window.localStorage?.getItem(LEGACY_KEY);
    if (!raw) return;
    legacy = JSON.parse(raw) || [];
  } catch { return; }
  if (!Array.isArray(legacy) || legacy.length === 0) {
    try { window.localStorage?.removeItem(LEGACY_KEY); } catch { /* ignore */ }
    return;
  }

  const rows = legacy
    .filter((d) => d && d.status !== 'deleted' && d.title)
    .map((d) => ({
      tenant_id: actor.tenantId,
      title: String(d.title).trim(),
      description: d.description || '',
      priority: d.priority || DefectPriority.MEDIUM,
      status: d.status || DefectStatus.NEW,
      department_owner: d.departmentOwner || d.targetDepartment || null,
      reported_by_name: d.reportedByName || d.createdByName || null,
      created_by_name: d.createdByName || d.reportedByName || null,
      created_by_department: d.createdByDepartment || null,
      created_by_tier: d.createdByTier || null,
      assignee_kind: d.assignedToUserId ? 'user' : 'unassigned',
      assigned_to_name: d.assignedToName || null,
      pending_for_department: d.pendingForDepartment || null,
      sent_for_acceptance: !!d.sentForAcceptance,
      submitted_by_name: d.submittedByName || null,
      decision_notes: d.decisionNotes || null,
      due_date: d.dueDate || null,
      closed_notes: d.closedNotes || null,
      closed_by_name: d.closedByName || null,
      closed_photo: d.closedPhoto || null,
      reopened_notes: d.reopenedNotes || null,
      reopened_by_name: d.reopenedByName || null,
      defect_type: d.defectType || null,
      defect_sub_type: d.defectSubType || null,
      affects_guest_areas: !!d.affectsGuestAreas,
      safety_related: !!d.safetyRelated,
      location_deck_id: d.locationDeckId || null,
      location_zone_id: d.locationZoneId || null,
      location_space_id: d.locationSpaceId || null,
      location_path_label: d.locationPathLabel || null,
      location_free_text: d.locationFreeText || '',
      photos: Array.isArray(d.photos) ? d.photos : [],
      is_archived_by_sender: !!d.isArchivedBySender,
      created_at: d.createdAt || undefined,
    }));

  if (rows.length) {
    const { error } = await supabase?.from('defects')?.insert(rows);
    if (error) { console.warn('[defects] legacy import failed — leaving localStorage intact', error); return; }
  }
  try { window.localStorage?.removeItem(LEGACY_KEY); } catch { /* ignore */ }
};

// Defect notifications — cross-device via public.notifications (was localStorage
// `cargo.notifications.v1`, which never left the browser). Recipients are resolved
// to real auth uids server-side (get_tenant_members_for_jobs RPC), then each is
// written through sendDbNotification so it reaches the nav bell on their device.
//
// Signatures take the `actor` ctx ({ tenantId, userId, ... }) so every call is
// tenant-scoped. The RPC is called directly here (not via defectsStorage) to
// avoid a circular import between the two modules.

import { supabase } from '../../../lib/supabaseClient';
import { sendDbNotification } from '../../../lib/dbNotifications';

export const DEFECT_NOTIFICATION_TYPES = {
  DEFECT_PENDING_ACCEPTANCE: 'DEFECT_PENDING_ACCEPTANCE',
  DEFECT_NEW_LOGGED: 'DEFECT_NEW_LOGGED',
  DEFECT_ACCEPTED: 'DEFECT_ACCEPTED',
  DEFECT_DECLINED: 'DEFECT_DECLINED',
  DEFECT_ASSIGNED: 'DEFECT_ASSIGNED',
};

export const SEVERITY = { INFO: 'info', WARN: 'warn', URGENT: 'urgent' };

const normTier = (t) => (t || '').trim().toUpperCase();

// Resolve auth uids of the CHIEF/COMMAND members of a department in this tenant.
const chiefsOfDepartment = async (tenantId, departmentId) => {
  if (!tenantId || !departmentId) return [];
  const { data, error } = await supabase?.rpc('get_tenant_members_for_jobs', {
    p_tenant_id: tenantId, p_department_id: departmentId,
  });
  if (error || !Array.isArray(data)) return [];
  return data
    .filter((m) => ['CHIEF', 'COMMAND'].includes(normTier(m?.permission_tier)))
    .map((m) => m?.user_id)
    .filter(Boolean);
};

// Fan a single notification out to many recipients (skips the actor themselves).
const notifyMany = async (userIds, actorId, payload) => {
  const unique = [...new Set((userIds || []).filter(Boolean))].filter((id) => id !== actorId);
  await Promise.all(unique.map((uid) => sendDbNotification(uid, payload)));
};

export const notifyChiefsPendingDefect = async (actor, departmentId, defectTitle, defectId) => {
  const chiefs = await chiefsOfDepartment(actor?.tenantId, departmentId);
  await notifyMany(chiefs, actor?.userId, {
    type: DEFECT_NOTIFICATION_TYPES.DEFECT_PENDING_ACCEPTANCE,
    title: 'Defect pending acceptance',
    message: defectTitle,
    actionUrl: `/defects/${defectId}`,
    severity: SEVERITY.WARN,
  });
};

export const notifyChiefsNewDefect = async (actor, departmentId, defectTitle, defectId) => {
  const chiefs = await chiefsOfDepartment(actor?.tenantId, departmentId);
  await notifyMany(chiefs, actor?.userId, {
    type: DEFECT_NOTIFICATION_TYPES.DEFECT_NEW_LOGGED,
    title: 'New defect logged',
    message: defectTitle,
    actionUrl: `/defects/${defectId}`,
    severity: SEVERITY.INFO,
  });
};

// Notify a named assignee (or the whole team — pass the resolved uid list).
export const notifyDefectAssigned = async (actor, userIds, defectTitle, defectId, dueDate) => {
  await notifyMany(userIds, actor?.userId, {
    type: DEFECT_NOTIFICATION_TYPES.DEFECT_ASSIGNED,
    title: 'Defect assigned to you',
    message: dueDate ? `${defectTitle} • due ${dueDate}` : defectTitle,
    actionUrl: `/defects/${defectId}`,
    severity: SEVERITY.WARN,
  });
};

// "Also notify" watchers added at log time (e.g. a HOD or the Captain) — FYI.
export const notifyDefectWatchers = async (actor, userIds, defectTitle, defectId) => {
  await notifyMany(userIds, actor?.userId, {
    type: DEFECT_NOTIFICATION_TYPES.DEFECT_NEW_LOGGED,
    title: 'Defect logged — for your awareness',
    message: defectTitle,
    actionUrl: `/defects/${defectId}`,
    severity: SEVERITY.INFO,
  });
};

export const notifySenderAccepted = async (actor, senderId, defectTitle, defectId) => {
  if (!senderId) return;
  await sendDbNotification(senderId, {
    type: DEFECT_NOTIFICATION_TYPES.DEFECT_ACCEPTED,
    title: 'Defect accepted',
    message: `${defectTitle} was accepted`,
    actionUrl: `/defects/${defectId}`,
    severity: SEVERITY.INFO,
  });
};

export const notifySenderDeclined = async (actor, senderId, defectTitle, defectId, reason) => {
  if (!senderId) return;
  await sendDbNotification(senderId, {
    type: DEFECT_NOTIFICATION_TYPES.DEFECT_DECLINED,
    title: 'Defect declined',
    message: reason ? `${defectTitle} declined • ${reason}` : `${defectTitle} was declined`,
    actionUrl: `/defects/${defectId}`,
    severity: SEVERITY.WARN,
  });
};

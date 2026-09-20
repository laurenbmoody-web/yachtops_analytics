// Job notifications, on the real table.
//
// These used to go to localStorage under 'cargo.notifications.v1' — which
// means they reached the bell of the browser that RAISED the job, and nobody
// else's, on no other device. Assignment was worse still: notifyJobAssigned
// in index.jsx was a console.log, so telling someone a job was theirs did
// nothing at all.
//
// public.notifications is RLS'd to its owner and already merged into the nav
// bell by lib/dbNotifications, so a row written here is the recipient's on
// whatever they next open.
//
// Recipients come from tenant_members, not from the localStorage user list:
// the old chief lookup read accounts a Supabase sign-in never writes, so on a
// fresh browser it found nobody and notified no one, silently.

import { supabase } from '../../../lib/supabaseClient';
import { sendDbNotification } from '../../../lib/dbNotifications';

const jobUrl = (jobId) => `/team-jobs-management?job=${jobId}`;

/** ' • Due 21/09/2026', or '' when there is no due date. */
const dueSuffix = (dueDate) => {
  if (!dueDate) return '';
  const d = new Date(dueDate);
  if (Number.isNaN(d?.getTime())) return '';
  const pad = (n) => String(n)?.padStart(2, '0');
  return ` • Due ${pad(d?.getDate())}/${pad(d?.getMonth() + 1)}/${d?.getFullYear()}`;
};

// One row per recipient. Never throws: a job that saved should not look like
// it failed because the telling-people part did.
const fanOut = async (userIds, payload) => {
  const ids = [...new Set((userIds || [])?.filter(Boolean))];
  if (!ids?.length) return 0;
  await Promise.all(ids?.map(id => sendDbNotification(id, payload)?.catch(() => {})));
  return ids?.length;
};

/**
 * "This one is yours."
 *
 * Skips the person doing the assigning — assigning a job to yourself is not
 * news, and a bell that pings for your own actions is a bell people mute.
 */
export const notifyJobAssigned = async ({ assigneeIds, jobTitle, jobId, dueDate, actorId }) => {
  const recipients = (assigneeIds || [])?.filter(id => id && id !== actorId);
  return fanOut(recipients, {
    type: 'job_assigned',
    title: 'New job assigned',
    message: `${jobTitle || 'A job'}${dueSuffix(dueDate)}`,
    actionUrl: jobUrl(jobId),
    severity: 'info',
  });
};

/**
 * A job handed to another department needs that department's chiefs to accept
 * it. Resolved live from tenant_members so it works on any device.
 */
export const notifyChiefsPendingAcceptance = async ({
  tenantId, departmentId, jobTitle, jobId, dueDate,
}) => {
  if (!tenantId || !departmentId) return 0;

  const { data, error } = await supabase
    ?.from('tenant_members')
    ?.select('user_id, permission_tier')
    ?.eq('tenant_id', tenantId)
    ?.eq('department_id', departmentId)
    ?.eq('active', true)
    ?.in('permission_tier', ['COMMAND', 'CHIEF', 'HOD']);
  if (error) {
    console.warn('[jobNotify] chief lookup failed:', error?.message || error);
    return 0;
  }

  return fanOut((data || [])?.map(r => r?.user_id), {
    type: 'job_pending_acceptance',
    title: 'Job awaiting approval',
    message: `${jobTitle || 'A job'}${dueSuffix(dueDate)}`,
    actionUrl: jobUrl(jobId),
    severity: 'warn',
  });
};

export const notifySenderAccepted = async ({ senderId, jobTitle, jobId, byDept }) =>
  fanOut([senderId], {
    type: 'job_handoff_accepted',
    title: 'Job accepted',
    message: `${jobTitle || 'A job'} accepted by ${byDept || 'another department'}`,
    actionUrl: jobUrl(jobId),
    severity: 'info',
  });

export const notifySenderDeclined = async ({ senderId, jobTitle, jobId, byDept, reason }) =>
  fanOut([senderId], {
    type: 'job_handoff_declined',
    title: 'Job declined',
    message: `${jobTitle || 'A job'} declined by ${byDept || 'another department'}`
      + (reason ? ` • ${reason}` : ''),
    actionUrl: jobUrl(jobId),
    severity: 'warn',
  });

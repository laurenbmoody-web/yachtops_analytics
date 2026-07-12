// dbNotifications — server-backed notification layer (cross-device).
//
// The nav bell historically read only localStorage (team-jobs util), which is
// per-browser. This module adds the DB `notifications` table as a parallel
// source so notifications written server-side (e.g. rota decisions) reach the
// recipient on any device. The bell MERGES both feeds; legacy localStorage
// notifications (jobs/inventory/HOR/delivery) are untouched.
//
// Rows are mapped to the same shape the localStorage feed uses
// ({ id, type, title, message, actionUrl, severity, isRead, createdAt }) plus
// a `_source: 'db'` tag so read/clear actions route to the right store.
//
// Reads/writes are RLS-scoped to the current user
// (20260611120000_notifications_owner_rls).

import { supabase } from './supabaseClient';

function mapRow(r) {
  // DB severity is stored upper- or lower-case across callers; normalise to
  // the localStorage feed's lowercase scale (info | warn | urgent).
  const sev = String(r.severity || 'info').toLowerCase();
  const severity = sev === 'warning' ? 'warn' : sev;
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    message: r.message,
    actionUrl: r.action_url || null,
    severity,
    isRead: !!r.read,
    createdAt: r.created_at,
    _source: 'db',
  };
}

export async function fetchDbNotifications(userId, { unreadOnly = false } = {}) {
  if (!userId) return [];
  let q = supabase
    .from('notifications')
    .select('id, type, title, message, severity, action_url, read, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (unreadOnly) q = q.eq('read', false);
  const { data, error } = await q;
  if (error) {
    console.warn('[dbNotifications] fetch failed:', error.message || error);
    return [];
  }
  return (data || []).map(mapRow);
}

export async function fetchDbUnreadCount(userId) {
  if (!userId) return 0;
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false);
  if (error) {
    console.warn('[dbNotifications] unread count failed:', error.message || error);
    return 0;
  }
  return count || 0;
}

export async function markDbNotificationRead(id) {
  if (!id) return;
  await supabase.from('notifications').update({ read: true }).eq('id', id)
    .then(() => {}).catch(() => {});
}

export async function markAllDbRead(userId) {
  if (!userId) return;
  await supabase.from('notifications').update({ read: true })
    .eq('user_id', userId).eq('read', false)
    .then(() => {}).catch(() => {});
}

export async function clearDbRead(userId) {
  if (!userId) return;
  await supabase.from('notifications').delete()
    .eq('user_id', userId).eq('read', true)
    .then(() => {}).catch(() => {});
}

// Delete a single DB notification (per-row dismiss). RLS scopes to the owner.
export async function deleteDbNotification(id) {
  if (!id) return;
  await supabase.from('notifications').delete().eq('id', id)
    .then(() => {}).catch(() => {});
}

// Write a notification for a user (server-backed, cross-device).
export async function sendDbNotification(userId, { type, title, message, actionUrl, severity = 'info' }) {
  if (!userId) return;
  await supabase.from('notifications').insert({
    user_id: userId,
    type,
    title,
    message,
    severity,
    action_url: actionUrl || null,
    read: false,
    created_at: new Date().toISOString(),
  }).then(() => {}).catch(() => {});
}

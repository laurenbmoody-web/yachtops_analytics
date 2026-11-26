// Ops / vessel calendar events — Supabase `ops_events`, written through the
// offline outbox.
//
// These used to live only in localStorage ('cargo.ops-events.v1'), so nothing a
// crew member put on the calendar was seen by anyone else on board. They are now
// shared per vessel. Reads are cached for offline automatically
// (src/lib/offline); writes queue at sea and sync later.
//
// Private events are the creator's alone (enforced by RLS). The finer audience
// rules (All Hands / Chiefs / HODs / Crew / a department) are applied below, as
// before.
//
// Event shape handed to the UI (unchanged from the localStorage era):
// { id, title, description, startDate, endDate, location, category, isPrivate,
//   visibility[], attachments[], createdBy, createdByName, createdAt,
//   editedBy, editedByName, editedAt, activity[] }

import { supabase } from '../../../lib/supabaseClient';
import { outbox } from '../../../lib/offline/queue';
import { newId } from '../../../lib/offline/ids';
import { getCurrentUser } from '../../../utils/authStorage';
import { enforceDepartmentScope } from '../../../utils/departmentScopeEnforcement';
import { getDepartmentScope } from '../../../utils/departmentScopeStorage';
import { logActivity } from '../../../utils/activityStorage';

const TABLE = 'ops_events';
const LEGACY_KEY = 'cargo.ops-events.v1';
const rowKey = (id) => `${TABLE}|${id}`;

export const OpsEventActions = {
  EVENT_CREATED: 'EVENT_CREATED',
  EVENT_UPDATED: 'EVENT_UPDATED',
  EVENT_DELETED: 'EVENT_DELETED',
};

const fromRow = (r) => ({
  id: r.id,
  title: r.title,
  description: r.description || '',
  startDate: r.start_date,
  endDate: r.end_date || null,
  location: r.location || '',
  category: r.category || '',
  isPrivate: !!r.is_private,
  visibility: r.visibility || [],
  attachments: r.attachments || [],
  createdBy: r.created_by,
  createdByName: r.created_by_name,
  createdAt: r.created_at,
  editedBy: r.edited_by || null,
  editedByName: r.edited_by_name || null,
  editedAt: r.edited_at || null,
  activity: r.activity || [],
});

const toRow = (e, tenantId) => ({
  id: e.id,
  tenant_id: tenantId,
  title: e.title,
  description: e.description || '',
  start_date: e.startDate,
  end_date: e.endDate || null,
  location: e.location || '',
  category: e.category || '',
  is_private: !!e.isPrivate,
  visibility: e.isPrivate ? [] : (e.visibility || []),
  attachments: e.attachments || [],
  activity: e.activity || [],
  created_by: e.createdBy,
  created_by_name: e.createdByName || null,
  edited_by: e.editedBy || null,
  edited_by_name: e.editedByName || null,
  edited_at: e.editedAt || null,
  created_at: e.createdAt || new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

const activityEntry = (action, userId, userName, details = {}) => ({
  id: newId(),
  action,
  userId,
  userName,
  timestamp: new Date().toISOString(),
  details,
});

// Audience filter — same rules the localStorage version applied.
const isVisibleTo = (event, user) => {
  if (event?.createdBy && event.createdBy === user?.id) return true;
  if (event?.isPrivate) return false;
  const v = event?.visibility || [];
  if (v.length === 0) return false;
  if (v.includes('All Hands')) return true;
  if (v.includes('Chiefs') && user?.tier === 'CHIEF') return true;
  if (v.includes('HODs') && user?.tier === 'HOD') return true;
  if (v.includes('Crew') && user?.tier === 'CREW') return true;
  if (v.includes('HODs + Crew') && (user?.tier === 'HOD' || user?.tier === 'CREW')) return true;
  if (user?.department && v.includes(user.department)) return true;
  return false;
};

/**
 * One-time lift of this device's old localStorage events into the shared
 * table. Only events this user created are moved (RLS only lets you insert as
 * yourself); anyone else's stay on the device until they sign in here.
 * Upsert on id, so a re-run (e.g. after an offline queue) is harmless.
 */
const migrateLegacyEvents = async (tenantId, userId) => {
  let legacy;
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]'); } catch { return; }
  if (!Array.isArray(legacy) || legacy.length === 0 || !tenantId || !userId) return;

  const mine = legacy.filter(e => e?.id && e?.createdBy === userId && e?.title && e?.startDate);
  if (mine.length === 0) return;

  const moved = new Set();
  for (const e of mine) {
    try {
      await outbox.submit({
        key: rowKey(e.id), table: TABLE, type: 'upsert', onConflict: 'id',
        row: toRow(e, tenantId), label: 'Moving a calendar event to the vessel calendar',
      });
      moved.add(e.id);
    } catch (err) {
      console.warn('[ops-events] could not move a local event:', err);
    }
  }
  try {
    const rest = legacy.filter(e => !moved.has(e?.id));
    if (rest.length) localStorage.setItem(LEGACY_KEY, JSON.stringify(rest));
    else localStorage.removeItem(LEGACY_KEY);
  } catch { /* ignore */ }
};

/**
 * Load the vessel's ops events visible to this user.
 * @returns {Promise<Array>}
 */
export const loadOpsEvents = async (tenantId, currentUser) => {
  const user = currentUser || getCurrentUser();
  if (!tenantId) return [];

  await migrateLegacyEvents(tenantId, user?.id);

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('tenant_id', tenantId)
    .order('start_date', { ascending: true });
  if (error) {
    console.error('Error loading ops events:', error);
    return [];
  }
  const visible = (data || []).map(fromRow).filter(e => isVisibleTo(e, user));
  return enforceDepartmentScope(visible, user, getDepartmentScope());
};

/**
 * Create an ops event. Throws on a real (online) failure.
 */
export const createOpsEvent = async (tenantId, eventData, userId, userName) => {
  const event = {
    id: newId(),
    title: eventData?.title,
    description: eventData?.description || '',
    startDate: eventData?.startDate,
    endDate: eventData?.endDate || null,
    location: eventData?.location || '',
    category: eventData?.category || '',
    isPrivate: !!eventData?.isPrivate,
    visibility: eventData?.visibility || [],
    attachments: eventData?.attachments || [],
    createdBy: userId,
    createdByName: userName,
    createdAt: new Date().toISOString(),
    editedBy: null,
    editedByName: null,
    editedAt: null,
    activity: [activityEntry('created event', userId, userName)],
  };
  if (!event.isPrivate && event.visibility.includes('All Hands')) {
    event.activity.push(activityEntry('confirmed All Hands visibility', userId, userName));
  }

  await outbox.submit({
    key: rowKey(event.id), table: TABLE, type: 'insert',
    row: toRow(event, tenantId), match: { id: event.id }, label: 'Adding a calendar event',
  });

  logActivity({
    module: 'calendar',
    action: OpsEventActions.EVENT_CREATED,
    entityType: 'ops_event',
    entityId: event.id,
    summary: `Calendar event created: ${event.title}`,
    meta: { title: event.title, category: event.category, startDate: event.startDate },
  });
  return event;
};

/**
 * Update an ops event. `oldEvent` is the event as the UI holds it (used for
 * the change log). Throws on a real (online) failure.
 */
export const updateOpsEvent = async (oldEvent, updates, userId, userName) => {
  if (!oldEvent?.id) return null;

  const changes = [];
  if (oldEvent.title !== updates?.title) changes.push('title');
  if (oldEvent.description !== updates?.description) changes.push('description');
  if (oldEvent.startDate !== updates?.startDate) changes.push('start date');
  if (oldEvent.endDate !== updates?.endDate) changes.push('end date');
  if (oldEvent.location !== updates?.location) changes.push('location');
  if (oldEvent.category !== updates?.category) changes.push('category');
  if (oldEvent.isPrivate !== updates?.isPrivate) changes.push('privacy');
  if (JSON.stringify(oldEvent.visibility) !== JSON.stringify(updates?.visibility)) changes.push('visibility');

  const activity = [...(oldEvent.activity || [])];
  if (changes.length) activity.push(activityEntry(`edited ${changes.join(', ')}`, userId, userName, { changes }));
  if (updates?.visibility?.includes('All Hands') && !oldEvent.visibility?.includes('All Hands')) {
    activity.push(activityEntry('confirmed All Hands visibility', userId, userName));
  }

  const editedAt = new Date().toISOString();
  const updated = { ...oldEvent, ...updates, activity, editedBy: userId, editedByName: userName, editedAt };

  await outbox.submit({
    key: rowKey(oldEvent.id), table: TABLE, type: 'update',
    patch: {
      title: updated.title,
      description: updated.description || '',
      start_date: updated.startDate,
      end_date: updated.endDate || null,
      location: updated.location || '',
      category: updated.category || '',
      is_private: !!updated.isPrivate,
      visibility: updated.isPrivate ? [] : (updated.visibility || []),
      attachments: updated.attachments || [],
      activity,
      edited_by: userId,
      edited_by_name: userName,
      edited_at: editedAt,
      updated_at: editedAt,
    },
    match: { id: oldEvent.id },
    label: 'Editing a calendar event',
  });

  logActivity({
    module: 'calendar',
    action: OpsEventActions.EVENT_UPDATED,
    entityType: 'ops_event',
    entityId: oldEvent.id,
    summary: `Calendar event updated: ${updated.title}`,
    meta: { title: updated.title, changes },
  });
  return updated;
};

/**
 * Delete an ops event. Throws on a real (online) failure.
 */
export const deleteOpsEvent = async (event) => {
  if (!event?.id) return false;
  await outbox.submit({
    key: rowKey(event.id), table: TABLE, type: 'delete',
    match: { id: event.id }, label: 'Deleting a calendar event',
  });
  logActivity({
    module: 'calendar',
    action: OpsEventActions.EVENT_DELETED,
    entityType: 'ops_event',
    entityId: event.id,
    summary: `Calendar event deleted: ${event.title}`,
    meta: { title: event.title },
  });
  return true;
};

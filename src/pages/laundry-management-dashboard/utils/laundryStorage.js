// Laundry Storage — Supabase-backed (vessel-scoped `laundry_items` table).
//
// Previously localStorage; now shared across the crew. Every export is async.
// Reads fetch the vessel's items and filter client-side (a vessel's laundry is
// a small set); writes go straight to Supabase. `archived_at` replaces the old
// client "reset day" flag. Photos are compressed base64 in a text column for
// now (a Storage bucket is a future optimisation).

import { supabase } from '../../../lib/supabaseClient';
import { getCurrentUser } from '../../../utils/authStorage';
import { logActivity } from '../../../utils/activityStorage';
import { showToast } from '../../../utils/toast';

// Owner / status / priority enums (unchanged — values match stored strings).
export const OwnerType = { GUEST: 'Guest', CREW: 'Crew' };
export const LaundryStatus = { IN_PROGRESS: 'InProgress', READY_TO_DELIVER: 'ReadyToDeliver', DELIVERED: 'Delivered' };
export const LaundryPriority = { NORMAL: 'Normal', URGENT: 'Urgent' };

// Care tags — stored as compact enum values, shown as human labels. Custom
// (free-text) tags fall through unchanged.
export const availableLaundryTags = ['DryClean', 'HandWash', 'StainTreat', 'Delicate', 'Express'];
export const LaundryTagLabels = {
  DryClean: 'Dry clean', HandWash: 'Hand wash', Iron: 'Iron',
  StainTreat: 'Stain treat', Delicate: 'Delicate', Express: 'Express',
};
export const formatLaundryTag = (t) => LaundryTagLabels[t] || t;

// Active vessel for the signed-in user (same mechanism the locations store uses).
const getTenantId = async () => {
  try {
    const { data, error } = await supabase?.rpc('get_my_context');
    if (error || !data?.[0]?.tenant_id) return null;
    return data[0].tenant_id;
  } catch (e) {
    console.error('[laundry] get_my_context failed', e);
    return null;
  }
};

// DB row (snake_case) → app item (camelCase), matching the historical shape.
const mapRow = (r) => ({
  id: r.id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deliveredAt: r.delivered_at,
  serviceDay: (r.created_at || '').split('T')[0],
  isArchivedFromToday: !!r.archived_at,
  createdByName: r.created_by_name,
  ownerType: r.owner_type,
  ownerId: r.owner_guest_id || r.owner_crew_user_id || null,
  ownerName: r.owner_name,
  ownerGuestId: r.owner_guest_id,
  ownerCrewUserId: r.owner_crew_user_id,
  ownerDisplayName: r.owner_display_name,
  area: r.area || '',
  areaLocationId: r.area_location_id,
  colour: r.colour || '',
  laundryNumber: r.laundry_number || '',
  photo: r.photo || '',
  photos: Array.isArray(r.photos) && r.photos.length ? r.photos : (r.photo ? [r.photo] : []),
  description: r.description || '',
  priority: r.priority || LaundryPriority.NORMAL,
  status: r.status,
  tags: Array.isArray(r.tags) ? r.tags : [],
  notes: r.notes || '',
  tripId: r.trip_id || null,
});

// ── date helpers ─────────────────────────────────────────────────────────────
export const getTodayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const localDateKey = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Day-key / migration helpers are obsolete under Supabase — kept as harmless
// no-ops so existing callers don't break.
export const getLastLaundryDayKey = () => null;
export const setLastLaundryDayKey = () => {};
export const isNewDay = () => false;
export const migrateLaundryItems = async () => 0;

// ── reads ────────────────────────────────────────────────────────────────────
export const loadAllLaundryItems = async () => {
  const tenantId = await getTenantId();
  if (!tenantId) return [];
  const { data, error } = await supabase
    .from('laundry_items')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (error) { console.error('[laundry] load failed', error); return []; }
  return (data || []).map(mapRow);
};
export const getAllLaundryItems = async () => loadAllLaundryItems();

// Custom care tags this vessel has used before (tenant-scoped, deduped, minus
// the built-in ones). Lets a typed tag like "No starch" come back as a
// ready-to-tap pill on future items — reuse per tenant, without a new table.
export const getKnownCustomTags = async () => {
  const tenantId = await getTenantId();
  if (!tenantId) return [];
  const { data, error } = await supabase
    .from('laundry_items')
    .select('tags')
    .eq('tenant_id', tenantId);
  if (error) { console.error('[laundry] custom tags load failed', error); return []; }
  const known = new Set(availableLaundryTags);
  const seen = new Set();
  const out = [];
  for (const row of data || []) {
    for (const t of (Array.isArray(row.tags) ? row.tags : [])) {
      const v = (t || '').trim();
      if (!v || known.has(v) || seen.has(v.toLowerCase())) continue;
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
};

// Today view: open items (not archived) + items delivered today (not archived).
export const getTodayViewItems = async () => {
  const items = await loadAllLaundryItems();
  const todayKey = getTodayKey();
  const openItems = items.filter((i) => !i.isArchivedFromToday
    && (i.status === LaundryStatus.IN_PROGRESS || i.status === LaundryStatus.READY_TO_DELIVER));
  const deliveredToday = items.filter((i) => !i.isArchivedFromToday
    && i.status === LaundryStatus.DELIVERED && localDateKey(i.deliveredAt) === todayKey);
  return { openItems, deliveredToday };
};

const isDeliveredToday = (i) => {
  if (i.status !== LaundryStatus.DELIVERED || !i.deliveredAt) return false;
  return localDateKey(i.deliveredAt) === getTodayKey();
};

export const getTodayLaundryCounts = async () => {
  const items = await loadAllLaundryItems();
  const itemsIn = items.filter((i) => i.status === LaundryStatus.IN_PROGRESS || i.status === LaundryStatus.READY_TO_DELIVER).length;
  const itemsOut = items.filter(isDeliveredToday).length;
  return { itemsIn, itemsOut };
};

export const getTodayLaundryBreakdown = async () => {
  const items = await loadAllLaundryItems();
  return {
    inProgress: items.filter((i) => i.status === LaundryStatus.IN_PROGRESS).length,
    readyToDeliver: items.filter((i) => i.status === LaundryStatus.READY_TO_DELIVER).length,
    delivered: items.filter(isDeliveredToday).length,
  };
};

export const getTodayLaundryItems = async () => {
  const items = await loadAllLaundryItems();
  const todayKey = getTodayKey();
  return items.filter((i) => localDateKey(i.createdAt) === todayKey);
};

export const getLaundryItemsByDate = async (date) => {
  const items = await loadAllLaundryItems();
  const key = localDateKey(new Date(date).toISOString());
  return items.filter((i) => localDateKey(i.createdAt) === key);
};

export const getLaundryItemsByDeliveredDate = async (dateKey) => {
  const items = await loadAllLaundryItems();
  return items.filter((i) => i.status === LaundryStatus.DELIVERED && localDateKey(i.deliveredAt) === dateKey);
};

export const getDeliveredDates = async () => {
  const items = await loadAllLaundryItems();
  const dates = new Set();
  items.forEach((i) => { if (i.status === LaundryStatus.DELIVERED && i.deliveredAt) dates.add(localDateKey(i.deliveredAt)); });
  return Array.from(dates).sort().reverse();
};

export const getActiveTodayLaundryItems = async () => {
  const { openItems, deliveredToday } = await getTodayViewItems();
  return [...openItems, ...deliveredToday];
};

export const getLaundryDates = async () => {
  const items = await loadAllLaundryItems();
  const dates = new Set();
  items.forEach((i) => dates.add(localDateKey(i.createdAt)));
  return Array.from(dates).filter(Boolean).sort().reverse();
};

// ── writes ───────────────────────────────────────────────────────────────────
export const createLaundryItem = async (itemData) => {
  const tenantId = await getTenantId();
  if (!tenantId) { showToast('No active vessel', 'error'); throw new Error('NO_TENANT'); }

  const normalized = ['guest', 'crew'].includes((itemData?.ownerType || '').toLowerCase())
    ? itemData.ownerType.toLowerCase() : 'unknown';
  const ownerName = itemData?.ownerName?.trim() ? itemData.ownerName : 'Unknown';
  const { data: authData } = await supabase.auth.getUser();
  const currentUser = getCurrentUser();

  const payload = {
    tenant_id: tenantId,
    owner_type: normalized,
    owner_name: ownerName,
    owner_display_name: itemData?.ownerDisplayName || ownerName,
    owner_guest_id: itemData?.ownerGuestId || null,
    owner_crew_user_id: itemData?.ownerCrewUserId || null,
    area: itemData?.area || '',
    area_location_id: itemData?.areaLocationId || null,
    colour: itemData?.colour || '',
    laundry_number: itemData?.laundryNumber || '',
    photos: Array.isArray(itemData?.photos) ? itemData.photos : (itemData?.photo ? [itemData.photo] : []),
    photo: (Array.isArray(itemData?.photos) ? itemData.photos[0] : itemData?.photo) || '',
    description: itemData?.description || '',
    priority: itemData?.priority || LaundryPriority.NORMAL,
    status: LaundryStatus.IN_PROGRESS,
    tags: itemData?.tags || [],
    notes: itemData?.notes || '',
    trip_id: itemData?.tripId || null,
    created_by: authData?.user?.id || null,
    created_by_name: currentUser?.fullName || currentUser?.name || 'Unknown User',
  };

  const { data, error } = await supabase.from('laundry_items').insert(payload).select('*').single();
  if (error) {
    console.error('[laundry] create failed', error);
    showToast('Failed to add laundry item. Please try again.', 'error');
    throw error;
  }

  try {
    logActivity({
      module: 'laundry', action: 'LAUNDRY_ITEM_CREATED', entityType: 'laundryItem', entityId: data.id,
      summary: `Added laundry item: ${data.description}`,
      meta: { ownerType: data.owner_type, ownerDisplayName: data.owner_display_name, priority: data.priority },
    });
  } catch (e) { console.error('Error logging activity:', e); }

  showToast('Laundry item added', 'success');
  return mapRow(data);
};

export const updateLaundryStatus = async (itemId, newStatus) => {
  const patch = { status: newStatus, updated_at: new Date().toISOString() };
  if (newStatus === LaundryStatus.DELIVERED) patch.delivered_at = new Date().toISOString();
  const { data, error } = await supabase.from('laundry_items').update(patch).eq('id', itemId).select('*').single();
  if (error) { console.error('[laundry] status update failed', error); showToast('Could not update status', 'error'); return null; }
  if (newStatus === LaundryStatus.DELIVERED) {
    try {
      logActivity({
        module: 'laundry', action: 'LAUNDRY_ITEM_DELIVERED', entityType: 'laundryItem', entityId: itemId,
        summary: `Delivered laundry: ${data.description}`, meta: { ownerType: data.owner_type, ownerName: data.owner_name },
      });
    } catch (e) { console.error('Error logging activity:', e); }
  }
  showToast('Status updated', 'success');
  return mapRow(data);
};

export const updateLaundryItem = async (itemId, updates) => {
  const map = {
    ownerName: 'owner_name', ownerDisplayName: 'owner_display_name', area: 'area', areaLocationId: 'area_location_id',
    colour: 'colour', laundryNumber: 'laundry_number', photo: 'photo', photos: 'photos', description: 'description',
    priority: 'priority', status: 'status', tags: 'tags', notes: 'notes',
  };
  const patch = { updated_at: new Date().toISOString() };
  Object.entries(updates || {}).forEach(([k, v]) => { if (map[k]) patch[map[k]] = v; });
  const { data, error } = await supabase.from('laundry_items').update(patch).eq('id', itemId).select('*').single();
  if (error) { console.error('[laundry] update failed', error); showToast('Could not update item', 'error'); return null; }
  showToast('Laundry item updated', 'success');
  return mapRow(data);
};

export const addNoteToLaundryItem = async (itemId, note) => {
  const { data: existing, error: readErr } = await supabase.from('laundry_items').select('notes').eq('id', itemId).single();
  if (readErr) { console.error('[laundry] note read failed', readErr); showToast('Laundry item not found', 'error'); return null; }
  const currentUser = getCurrentUser();
  const userName = currentUser?.fullName || currentUser?.name || 'Unknown User';
  const stamped = `[${new Date().toLocaleString('en-GB')}] ${userName}: ${note}`;
  const notes = existing?.notes ? `${existing.notes}\n${stamped}` : stamped;
  const { data, error } = await supabase.from('laundry_items').update({ notes, updated_at: new Date().toISOString() }).eq('id', itemId).select('*').single();
  if (error) { console.error('[laundry] note update failed', error); return null; }
  showToast('Note added', 'success');
  return mapRow(data);
};

// Command/Chief only: archive today's delivered items so they leave the Today
// view (the multi-user equivalent of the old "reset day").
export const manualResetDay = async () => {
  const currentUser = getCurrentUser();
  const tier = (currentUser?.effectiveTier || currentUser?.tier || '').trim().toUpperCase();
  if (tier !== 'COMMAND' && tier !== 'CHIEF') { showToast('Only Command/Chief can reset the day', 'error'); return false; }
  const tenantId = await getTenantId();
  if (!tenantId) return false;
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const { error } = await supabase.from('laundry_items')
    .update({ archived_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('status', LaundryStatus.DELIVERED)
    .is('archived_at', null)
    .gte('delivered_at', todayStart.toISOString());
  if (error) { console.error('[laundry] reset failed', error); showToast('Could not reset the day', 'error'); return false; }
  try {
    logActivity({ module: 'laundry', action: 'LAUNDRY_MANUAL_RESET', entityType: 'laundryItem', entityId: 'manual-reset', summary: 'Reset laundry day view', meta: { resetDate: getTodayKey() } });
  } catch (e) { console.error('Error logging activity:', e); }
  showToast('Day reset — delivered items cleared from Today.', 'success');
  return true;
};
export const resetDailyDelivered = async () => manualResetDay();

export const deleteLaundryItem = async (itemId) => {
  const { error } = await supabase.from('laundry_items').delete().eq('id', itemId);
  if (error) { console.error('[laundry] delete failed', error); showToast('Could not delete item', 'error'); return false; }
  return true;
};

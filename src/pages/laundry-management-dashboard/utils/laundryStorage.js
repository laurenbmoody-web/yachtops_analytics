// Laundry Storage — Supabase-backed (vessel-scoped `laundry_items` table).
//
// Previously localStorage; now shared across the crew. Every export is async.
// Reads fetch the vessel's items and filter client-side (a vessel's laundry is
// a small set); writes go straight to Supabase. `archived_at` replaces the old
// client "reset day" flag. Photos live in the private `laundry-photos` Storage
// bucket — rows store object paths, resolved to signed URLs on read (legacy
// base64 photos still pass through).

import { supabase } from '../../../lib/supabaseClient';
import { getCurrentUser } from '../../../utils/authStorage';
import { logActivity } from '../../../utils/activityStorage';
import { showToast } from '../../../utils/toast';
import { uploadLaundryPhotos, resolveLaundryPhotos, deleteLaundryPhotos, isStoredPath } from './laundryPhotos';

// Owner / status / priority enums (unchanged — values match stored strings).
export const OwnerType = { GUEST: 'Guest', CREW: 'Crew', OTHER: 'Other' };
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
  neededBy: r.needed_by || null,
  flag: r.flag || null,
  flagNote: r.flag_note || '',
  serviceLocation: r.service_location || 'onboard',
  vendor: r.vendor || '',
  sentAt: r.sent_at || null,
  expectedBack: r.expected_back || null,
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

// ── activity log ─────────────────────────────────────────────────────────────
// Append an event (who did what, when). Best-effort — never blocks the action.
const ACTION_FOR_STATUS = {
  [LaundryStatus.IN_PROGRESS]: 'reopened',
  [LaundryStatus.READY_TO_DELIVER]: 'ready',
  [LaundryStatus.DELIVERED]: 'delivered',
};
const logLaundryEvent = async (itemId, tenantId, action) => {
  if (!itemId || !tenantId || !action) return;
  try {
    const { data: authData } = await supabase.auth.getUser();
    const u = getCurrentUser();
    const meta = authData?.user?.user_metadata || {};
    let actorName = u?.fullName || u?.name || meta.full_name || meta.name || meta.fullName;
    if (!actorName && authData?.user?.id) {
      try {
        const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', authData.user.id).single();
        actorName = prof?.full_name;
      } catch (e) { /* ignore */ }
    }
    actorName = actorName || authData?.user?.email || 'Someone';
    await supabase.from('laundry_item_events').insert({
      tenant_id: tenantId, item_id: itemId, action,
      actor_id: authData?.user?.id || null,
      actor_name: actorName,
    });
  } catch (e) { /* non-fatal */ }
};

const mapEvent = (r) => ({ id: r.id, itemId: r.item_id, action: r.action, actorName: r.actor_name, actorId: r.actor_id, at: r.at });

export const getLaundryEvents = async (itemId) => {
  if (!itemId) return [];
  const { data, error } = await supabase
    .from('laundry_item_events')
    .select('*')
    .eq('item_id', itemId)
    .order('at', { ascending: true });
  if (error) { console.error('[laundry] events load failed', error); return []; }
  return (data || []).map(mapEvent);
};

// Recent activity across the vessel, joined to the item, for the history page.
export const getRecentLaundryActivity = async (limit = 200) => {
  const tenantId = await getTenantId();
  if (!tenantId) return [];
  const { data, error } = await supabase
    .from('laundry_item_events')
    .select('*, laundry_items(description, owner_type, owner_name, owner_display_name, area, priority, photo, photos, colour, laundry_number)')
    .eq('tenant_id', tenantId)
    .order('at', { ascending: false })
    .limit(limit);
  if (error) { console.error('[laundry] activity load failed', error); return []; }
  return (data || []).map((r) => ({
    ...mapEvent(r),
    item: r.laundry_items ? {
      description: r.laundry_items.description,
      ownerType: r.laundry_items.owner_type,
      ownerName: r.laundry_items.owner_name,
      area: r.laundry_items.area,
      priority: r.laundry_items.priority,
      photo: r.laundry_items.photo,
      photos: r.laundry_items.photos,
    } : null,
  }));
};

// Who took each piece to "delivered" (the final step) — item_id → {actorId, actorName}.
// Latest delivered event wins if a piece was re-opened and re-delivered.
export const getDeliveryCredits = async () => {
  const tenantId = await getTenantId();
  if (!tenantId) return {};
  const { data, error } = await supabase
    .from('laundry_item_events')
    .select('item_id, actor_id, actor_name, at')
    .eq('tenant_id', tenantId)
    .eq('action', 'delivered')
    .order('at', { ascending: false });
  if (error) { console.error('[laundry] delivery credits failed', error); return {}; }
  const map = {};
  for (const r of data || []) {
    if (!map[r.item_id]) map[r.item_id] = { actorId: r.actor_id || null, actorName: r.actor_name || null };
  }
  return map;
};

// Per-vessel photo-retention policy (null = keep forever). Read/written on the
// vessels row; the scheduled purge (when enabled) acts on this.
export const getPhotoRetentionDays = async () => {
  const tenantId = await getTenantId();
  if (!tenantId) return null;
  const { data } = await supabase.from('vessels').select('laundry_photo_retention_days').eq('tenant_id', tenantId).maybeSingle();
  return data?.laundry_photo_retention_days ?? null;
};
export const setPhotoRetentionDays = async (days) => {
  const tenantId = await getTenantId();
  if (!tenantId) return false;
  const { error } = await supabase.from('vessels').update({ laundry_photo_retention_days: days }).eq('tenant_id', tenantId);
  if (error) { console.error('[laundry] retention save failed', error); showToast('Could not save retention', 'error'); return false; }
  showToast('Photo retention updated', 'success');
  return true;
};

// Vessel identity for report letterheads (name, company, flag, port, IMO, logo).
export const getVesselBranding = async () => {
  const tenantId = await getTenantId();
  if (!tenantId) return null;
  const { data } = await supabase.from('vessels')
    .select('name, company_name, flag, port_of_registry, imo_number, logo_url')
    .eq('tenant_id', tenantId).maybeSingle();
  if (!data) return null;
  return {
    name: data.name || '',
    company: data.company_name || '',
    flag: data.flag || '',
    port: data.port_of_registry || '',
    imo: data.imo_number || '',
    logoUrl: data.logo_url || '',
  };
};

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
  // Resolve photo paths → signed URLs for the items actually shown.
  const resolved = await resolveLaundryPhotos([...openItems, ...deliveredToday]);
  const byId = new Map(resolved.map((i) => [i.id, i]));
  return {
    openItems: openItems.map((i) => byId.get(i.id) || i),
    deliveredToday: deliveredToday.map((i) => byId.get(i.id) || i),
  };
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

  const normalized = ['guest', 'crew', 'other'].includes((itemData?.ownerType || '').toLowerCase())
    ? itemData.ownerType.toLowerCase() : 'unknown';
  const ownerName = itemData?.ownerName?.trim() ? itemData.ownerName : 'Unknown';
  const { data: authData } = await supabase.auth.getUser();
  const currentUser = getCurrentUser();

  // Upload any freshly-captured photos (data URLs) to the bucket first.
  const rawPhotos = Array.isArray(itemData?.photos) ? itemData.photos : (itemData?.photo ? [itemData.photo] : []);
  const storedPhotos = await uploadLaundryPhotos(tenantId, rawPhotos);

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
    photos: storedPhotos,
    photo: storedPhotos[0] || '',
    description: itemData?.description || '',
    priority: itemData?.priority || LaundryPriority.NORMAL,
    status: LaundryStatus.IN_PROGRESS,
    tags: itemData?.tags || [],
    notes: itemData?.notes || '',
    trip_id: itemData?.tripId || null,
    needed_by: itemData?.neededBy || null,
    created_by: authData?.user?.id || null,
    created_by_name: currentUser?.fullName || currentUser?.name || 'Unknown User',
  };

  const { data, error } = await supabase.from('laundry_items').insert(payload).select('*').single();
  if (error) {
    console.error('[laundry] create failed', error);
    // Offline / server-unreachable: don't toast a failure — the caller queues it.
    const offlineish = (typeof navigator !== 'undefined' && navigator.onLine === false)
      || /fetch|network|Failed to fetch|timeout/i.test(error.message || '');
    if (!offlineish) showToast('Failed to add laundry item. Please try again.', 'error');
    const e = new Error(error.message || 'create failed');
    e.code = offlineish ? 'OFFLINE' : 'CREATE_FAILED';
    throw e;
  }

  try {
    logActivity({
      module: 'laundry', action: 'LAUNDRY_ITEM_CREATED', entityType: 'laundryItem', entityId: data.id,
      summary: `Added laundry item: ${data.description}`,
      meta: { ownerType: data.owner_type, ownerDisplayName: data.owner_display_name, priority: data.priority },
    });
  } catch (e) { console.error('Error logging activity:', e); }
  logLaundryEvent(data.id, data.tenant_id, 'created');

  showToast('Laundry item added', 'success');
  return mapRow(data);
};

export const updateLaundryStatus = async (itemId, newStatus) => {
  const patch = { status: newStatus, updated_at: new Date().toISOString() };
  if (newStatus === LaundryStatus.DELIVERED) patch.delivered_at = new Date().toISOString();
  const { data, error } = await supabase.from('laundry_items').update(patch).eq('id', itemId).select('*').single();
  if (error) { console.error('[laundry] status update failed', error); showToast('Could not update status', 'error'); return null; }
  logLaundryEvent(data.id, data.tenant_id, ACTION_FOR_STATUS[newStatus] || 'updated');
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
    ownerType: 'owner_type', ownerName: 'owner_name', ownerDisplayName: 'owner_display_name',
    ownerGuestId: 'owner_guest_id', ownerCrewUserId: 'owner_crew_user_id',
    area: 'area', areaLocationId: 'area_location_id',
    colour: 'colour', laundryNumber: 'laundry_number', photo: 'photo', photos: 'photos', description: 'description',
    priority: 'priority', status: 'status', tags: 'tags', notes: 'notes',
    neededBy: 'needed_by', flag: 'flag', flagNote: 'flag_note',
    serviceLocation: 'service_location', vendor: 'vendor', sentAt: 'sent_at', expectedBack: 'expected_back',
  };
  // Photos edited → upload any new data URLs to the bucket before saving.
  let up = updates || {};
  if (Object.prototype.hasOwnProperty.call(up, 'photos')) {
    const tid = await getTenantId();
    const stored = await uploadLaundryPhotos(tid, up.photos || []);
    // orphan cleanup — remove files that were dropped in this edit
    try {
      const { data: prev } = await supabase.from('laundry_items').select('photos').eq('id', itemId).single();
      const oldPaths = (Array.isArray(prev?.photos) ? prev.photos : []).filter(isStoredPath);
      const removed = oldPaths.filter((p) => !stored.includes(p));
      if (removed.length) deleteLaundryPhotos(removed);
    } catch (e) { /* non-fatal */ }
    up = { ...up, photos: stored, photo: stored[0] || '' };
  }
  const patch = { updated_at: new Date().toISOString() };
  Object.entries(up).forEach(([k, v]) => { if (map[k]) patch[map[k]] = v; });
  const { data, error } = await supabase.from('laundry_items').update(patch).eq('id', itemId).select('*').single();
  if (error) { console.error('[laundry] update failed', error); showToast('Could not update item', 'error'); return null; }
  logLaundryEvent(data.id, data.tenant_id, 'edited');
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

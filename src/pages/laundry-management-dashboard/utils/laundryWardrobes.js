// Laundry wardrobes — vessel-scoped, persistent HOMES a garment lives in (the
// owner's wardrobe, a cabin's drawers). Membership is the `wardrobe_id` FK on
// laundry_items (see laundryStorage.setLaundryItemsWardrobe /
// loadLaundryItemsByWardrobe). This module owns the wardrobes table only.

import { supabase } from '../../../lib/supabaseClient';
import { getCurrentUser } from '../../../utils/authStorage';
import { showToast } from '../../../utils/toast';

const getTenantId = async () => {
  try {
    const { data, error } = await supabase?.rpc('get_my_context');
    if (error || !data?.[0]?.tenant_id) return null;
    return data[0].tenant_id;
  } catch (e) {
    console.error('[laundry-wardrobes] get_my_context failed', e);
    return null;
  }
};

// Which world a wardrobe belongs to.
export const WardrobeScope = { OWNER: 'owner', CHARTER: 'charter', CREW: 'crew' };
export const WardrobeScopeLabels = { owner: 'Owner', charter: 'Charter', crew: 'Crew' };

const mapWardrobe = (r) => ({
  id: r.id,
  name: r.name || 'Wardrobe',
  location: r.location || '',
  locationId: r.location_id || null,
  locationName: r.vessel_location?.name || '',
  scope: r.scope || 'owner',
  notes: r.notes || '',
  createdByName: r.created_by_name || '',
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const SELECT = '*, vessel_location:vessel_locations(name)';

export const loadWardrobes = async (scope = null) => {
  const tenantId = await getTenantId();
  if (!tenantId) return [];
  let q = supabase.from('laundry_wardrobes').select(SELECT).eq('tenant_id', tenantId).is('archived_at', null);
  if (scope) q = q.eq('scope', scope);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) { console.error('[laundry-wardrobes] load failed', error); return []; }
  return (data || []).map(mapWardrobe);
};

export const getWardrobeById = async (id) => {
  if (!id) return null;
  const { data, error } = await supabase.from('laundry_wardrobes').select(SELECT).eq('id', id).is('archived_at', null).maybeSingle();
  if (error || !data) return null;
  return mapWardrobe(data);
};

export const createWardrobe = async ({ name, location, locationId, scope, notes } = {}) => {
  const tenantId = await getTenantId();
  if (!tenantId) return null;
  const u = getCurrentUser();
  const { data: auth } = await supabase.auth.getUser();
  const payload = {
    tenant_id: tenantId,
    name: (name || '').trim() || 'New wardrobe',
    location: (location || '').trim() || null,
    location_id: locationId || null,
    scope: scope || 'owner',
    notes: (notes || '').trim() || null,
    created_by: auth?.user?.id || null,
    created_by_name: u?.fullName || u?.name || null,
  };
  const { data, error } = await supabase.from('laundry_wardrobes').insert(payload).select(SELECT).single();
  if (error) { console.error('[laundry-wardrobes] create failed', error); showToast('Could not create wardrobe', 'error'); return null; }
  return mapWardrobe(data);
};

export const updateWardrobe = async (id, updates) => {
  const map = { name: 'name', location: 'location', locationId: 'location_id', scope: 'scope', notes: 'notes' };
  const patch = { updated_at: new Date().toISOString() };
  Object.entries(updates || {}).forEach(([k, v]) => { if (map[k]) patch[map[k]] = (typeof v === 'string' ? v.trim() : v) || null; });
  const { data, error } = await supabase.from('laundry_wardrobes').update(patch).eq('id', id).select(SELECT).single();
  if (error) { console.error('[laundry-wardrobes] update failed', error); showToast('Could not update wardrobe', 'error'); return null; }
  return mapWardrobe(data);
};

// Archive a wardrobe: clear the home off its items first (they become loose),
// then archive the row.
export const archiveWardrobe = async (id) => {
  await supabase.from('laundry_items').update({ wardrobe_id: null }).eq('wardrobe_id', id);
  const { error } = await supabase.from('laundry_wardrobes').update({ archived_at: new Date().toISOString() }).eq('id', id);
  if (error) { console.error('[laundry-wardrobes] archive failed', error); showToast('Could not remove wardrobe', 'error'); return false; }
  return true;
};

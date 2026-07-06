// Inventory lookups for the vessel map — items live in inventory_items and
// attach to inventory_locations by TEXT (location + sub_location); nested
// sub-paths use " > " separators. Reads only; member RLS covers crew.
import { supabase } from '../../../lib/supabaseClient';

const clean = (q) => q.replace(/[,%]/g, ' ').trim();

export async function searchInventoryItems(tenantId, query) {
  const q = clean(query);
  if (!q) return { items: [] };
  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, name, quantity, unit')
    .eq('tenant_id', tenantId)
    .ilike('name', `%${q}%`)
    .limit(8);
  if (error) {
    console.error('[inventory] item search error:', error);
    return { error: error.message || 'Could not search inventory.' };
  }
  return { items: data || [] };
}

export async function searchInventoryLocations(tenantId, query) {
  const q = clean(query);
  if (!q) return { locations: [] };
  const { data, error } = await supabase
    .from('inventory_locations')
    .select('id, location, sub_location')
    .eq('tenant_id', tenantId)
    .or(`location.ilike.%${q}%,sub_location.ilike.%${q}%`)
    .limit(8);
  if (error) {
    console.error('[inventory] location search error:', error);
    return { error: error.message || 'Could not search locations.' };
  }
  return { locations: data || [] };
}

export async function getInventoryLocation(locationId) {
  const { data, error } = await supabase
    .from('inventory_locations')
    .select('id, location, sub_location')
    .eq('id', locationId)
    .single();
  if (error) {
    console.error('[inventory] location fetch error:', error);
    return { error: error.message || 'Could not load the linked location.' };
  }
  return { location: data };
}

// Everything stored at the location, including nested sub-paths
// ("Pantries > Bridge Pantry" matches itself and "… > Top shelf").
export async function itemsAtLocation(tenantId, location) {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, name, quantity, unit, sub_location')
    .eq('tenant_id', tenantId)
    .eq('location', location.location)
    .order('name', { ascending: true });
  if (error) {
    console.error('[inventory] items fetch error:', error);
    return { error: error.message || 'Could not load the location’s items.' };
  }
  const sub = (location.sub_location || '').trim();
  const items = (data || []).filter((i) => {
    if (!sub) return true;
    const isub = (i.sub_location || '').trim();
    return isub === sub || isub.startsWith(`${sub} > `);
  });
  return { items };
}

export const locationLabel = (loc) =>
  loc ? [loc.location, loc.sub_location].filter(Boolean).join(' · ') : '';

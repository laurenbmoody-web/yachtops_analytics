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

export async function getInventoryItem(itemId) {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, name, quantity, unit, location, sub_location, stock_locations, total_qty')
    .eq('id', itemId)
    .single();
  if (error) {
    console.error('[inventory] item fetch error:', error);
    return { error: error.message || 'Could not load the item.' };
  }
  return { item: data };
}

// Stock-location entries carry historical key variants — normalise to the
// client shape inventoryStorage writes ({locationName, subLocation, qty}).
const normSls = (raw) => (Array.isArray(raw) ? raw.filter(Boolean).map((l) => ({
  ...l,
  locationName: l.locationName || l.location_name || l.name || '',
  subLocation: l.subLocation ?? l.sub_location ?? '',
  qty: Number(l.qty ?? l.quantity) || 0,
})) : []);
const norm = (s) => (s || '').trim().toLowerCase();
const matchesLoc = (name, sub, loc) => {
  if (norm(name) !== norm(loc.location)) return false;
  const S = norm(loc.sub_location);
  const s = norm(sub);
  return !S || s === S || s.startsWith(`${S} > `);
};

// How many of the item sit at the pin's linked location ("here") — falls
// back to the vessel-wide count ("onboard") when the pin has no linked
// location or the item lives elsewhere. Quantities stay in inventory; the
// tag never stores its own count.
export function quantityAt(item, loc) {
  if (!item) return null;
  const sls = normSls(item.stock_locations);
  if (loc) {
    const hit = sls.find((l) => matchesLoc(l.locationName, l.subLocation, loc));
    if (hit) return { qty: hit.qty, where: 'here' };
    if (sls.length === 0 && matchesLoc(item.location, item.sub_location, loc)) {
      return { qty: Number(item.quantity ?? item.total_qty) || 0, where: 'here' };
    }
  }
  const total = sls.length > 0
    ? sls.reduce((sum, l) => sum + l.qty, 0)
    : Number(item.total_qty ?? item.quantity) || 0;
  return { qty: total, where: 'onboard' };
}

// Set how many of the item sit at the pin's linked location, writing to
// inventory (the single source of truth) — never to the tag. Assigning a
// count to a new spot SPLITS the existing stock (primary keeps the rest)
// rather than inflating the total.
export async function setQuantityHere(itemId, loc, qty) {
  const { data: row, error: readError } = await supabase
    .from('inventory_items')
    .select('id, quantity, total_qty, location, sub_location, stock_locations')
    .eq('id', itemId)
    .single();
  if (readError) {
    console.error('[inventory] qty read error:', readError);
    return { error: readError.message || 'Could not load the item.' };
  }
  const sls = normSls(row.stock_locations);
  let patch;
  if (loc) {
    const i = sls.findIndex((l) => matchesLoc(l.locationName, l.subLocation, loc));
    if (i >= 0) {
      sls[i] = { ...sls[i], qty };
    } else if (sls.length === 0 && matchesLoc(row.location, row.sub_location, loc)) {
      // Single-location item stored right here — just set the master count.
      patch = { quantity: qty, total_qty: qty };
    } else if (sls.length === 0) {
      // Split: the primary location keeps the remainder.
      const primary = Number(row.quantity ?? row.total_qty) || 0;
      sls.push(
        { locationName: row.location || '', subLocation: row.sub_location || '', qty: Math.max(0, primary - qty) },
        { locationName: loc.location, subLocation: loc.sub_location || '', qty },
      );
    } else {
      sls.push({ locationName: loc.location, subLocation: loc.sub_location || '', qty });
    }
    if (!patch) {
      const total = sls.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
      patch = { stock_locations: sls, quantity: total, total_qty: total };
    }
  } else {
    // No linked location — the count edits the onboard total, which is only
    // unambiguous while the stock isn't split.
    if (sls.length > 1) return { error: 'Stored in several locations — edit it in inventory.' };
    if (sls.length === 1) {
      patch = { stock_locations: [{ ...sls[0], qty }], quantity: qty, total_qty: qty };
    } else {
      patch = { quantity: qty, total_qty: qty };
    }
  }
  const { error: writeError } = await supabase.from('inventory_items').update(patch).eq('id', itemId);
  if (writeError) {
    console.error('[inventory] qty write error:', writeError);
    return { error: writeError.message || 'Could not save the count.' };
  }
  return {};
}

// Reverse direction: every map pin whose photos carry a tag for this item.
// Pins are few (tens per vessel) — fetch and sift client-side rather than
// wrestling jsonb path filters.
export async function findItemOnMap(tenantId, itemId) {
  const [{ data: pins, error: pinsError }, { data: scans, error: scansError }] = await Promise.all([
    supabase.from('scan_hotspots').select('id, label, scan_id, detail').eq('tenant_id', tenantId),
    supabase.from('vessel_scans').select('id, name').eq('tenant_id', tenantId).eq('status', 'ready'),
  ]);
  if (pinsError || scansError) {
    const e = pinsError || scansError;
    console.error('[inventory] map presence fetch error:', e);
    return { error: e.message || 'Could not check the vessel map.' };
  }
  const scanName = Object.fromEntries((scans || []).map((s) => [s.id, s.name]));
  const places = (pins || []).flatMap((h) => {
    const spots = (h.detail?.photos || [])
      .flatMap((p) => p.tags || [])
      .filter((t) => t.item_id === itemId).length;
    if (spots === 0 || !scanName[h.scan_id]) return [];
    return [{ hotspotId: h.id, label: h.label, scanId: h.scan_id, scanName: scanName[h.scan_id], spots }];
  });
  return { places };
}

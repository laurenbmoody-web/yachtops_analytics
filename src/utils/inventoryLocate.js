// Find inventory items by name and resolve where their stock physically lives
// on the vessel — the shared engine behind "show me where the champagne is".
//
// Stock is held on inventory_items.stock_locations as [{vesselLocationId, qty,
// locationName}]. A location can be a deep node (room › cupboard › shelf), so we
// roll each one up to the nearest ancestor that is either placed on a deck plan
// or has a scan — i.e. the "room" a human would point to — and attach that
// room's scan (if any) so callers can open it on the map.
import { supabase } from '../lib/supabaseClient';

const getTenantId = async () => {
  try {
    const { data, error } = await supabase?.rpc('get_my_context');
    if (error || !data?.[0]?.tenant_id) return null;
    return data[0].tenant_id;
  } catch { return null; }
};

// Search items whose name contains `query`; return each with the rooms its stock
// sits in. Shape: [{ itemId, name, rooms:[{ roomId, roomName, placed, scanId, qty }] }].
// Items with no resolvable location are dropped (nothing to locate).
export async function searchInventoryLocations(query, { limit = 20 } = {}) {
  const q = (query || '').trim();
  if (!q) return [];
  const tenantId = await getTenantId();
  if (!tenantId) return [];

  const { data: items, error: itemErr } = await supabase
    .from('inventory_items')
    .select('id, name, stock_locations')
    .eq('tenant_id', tenantId)
    .ilike('name', `%${q}%`)
    .limit(limit);
  if (itemErr || !items?.length) return [];

  // The location tree (for rollup + names + which nodes are placed on a plan).
  const { data: locs } = await supabase
    .from('vessel_locations')
    .select('id, name, parent_id, plan_x')
    .eq('tenant_id', tenantId)
    .eq('is_archived', false);
  const byId = {};
  (locs || []).forEach((l) => { byId[l.id] = l; });

  // Ready scans keyed by the room they belong to (first ready one wins).
  const { data: scans } = await supabase
    .from('vessel_scans')
    .select('id, space_id, status')
    .eq('tenant_id', tenantId)
    .not('space_id', 'is', null);
  const scanByRoom = {};
  const roomByScan = {};
  (scans || []).forEach((s) => {
    if (s.status === 'ready' && !scanByRoom[s.space_id]) scanByRoom[s.space_id] = s.id;
    roomByScan[s.id] = s.space_id;
  });

  // Pins holding this stock: a hotspot's location_node_id equals the stock's
  // vesselLocationId. The pin physically lives in its scan's room, so we can
  // pulse it there. Keyed node → { hotspotId, scanId, label }.
  const nodeIds = [];
  (items || []).forEach((it) => (it.stock_locations || []).forEach((sl) => {
    const v = sl?.vesselLocationId || sl?.locationId; if (v) nodeIds.push(v);
  }));
  const hotspotByNode = {};
  if (nodeIds.length) {
    const { data: hs } = await supabase
      .from('scan_hotspots')
      .select('id, scan_id, label, layer, location_node_id')
      .in('location_node_id', [...new Set(nodeIds)]);
    (hs || []).forEach((h) => { if (h.location_node_id && !hotspotByNode[h.location_node_id]) hotspotByNode[h.location_node_id] = h; });
  }

  // Nearest ancestor (incl. self) that is placed on a plan or scanned — else the
  // top-most known ancestor. That's the room a person would name.
  const roomFor = (id) => {
    let cur = id;
    let fallback = id;
    for (let i = 0; i < 12 && cur; i++) {
      const n = byId[cur];
      if (!n) break;
      fallback = cur;
      if (n.plan_x != null || scanByRoom[cur]) return cur;
      cur = n.parent_id;
    }
    return fallback;
  };

  return (items || []).map((it) => {
    const rooms = [];
    const byRoom = {};
    let pin = null; // the first hotspot physically holding this item, if any
    for (const sl of (it.stock_locations || [])) {
      const vid = sl?.vesselLocationId || sl?.locationId;
      const qty = Number(sl?.qty ?? sl?.quantity ?? 0) || 0;
      if (!vid) continue;
      // Does a map pin hold this stock? The pin lives in its scan's room. When
      // an item sits in more than one pin, prefer the real stock pin (an
      // Inventory/Safety/Storage pin) over a plain "shelf"/general marker.
      const hs = hotspotByNode[vid];
      if (hs) {
        const proom = roomByScan[hs.scan_id];
        const rank = { inventory: 3, safety: 2, storage: 1 };
        const cand = {
          hotspotId: hs.id,
          scanId: hs.scan_id,
          label: hs.label || '',
          layer: hs.layer || 'general',
          roomId: proom || null,
          roomName: byId[proom]?.name || null,
          placed: byId[proom]?.plan_x != null,
        };
        if (!pin || (rank[cand.layer] || 0) > (rank[pin.layer] || 0)) pin = cand;
      }
      const roomId = roomFor(vid);
      if (!roomId) continue;
      if (byRoom[roomId]) { byRoom[roomId].qty += qty; continue; }
      const room = {
        roomId,
        roomName: byId[roomId]?.name || sl?.locationName || 'Unknown',
        placed: byId[roomId]?.plan_x != null,
        scanId: scanByRoom[roomId] || null,
        qty,
      };
      byRoom[roomId] = room;
      rooms.push(room);
    }
    // Attach the pin to its own room (the one the scan belongs to) so callers
    // can pulse the room AND open the exact pin in the scan.
    if (pin?.roomId && byRoom[pin.roomId]) {
      byRoom[pin.roomId].hotspotId = pin.hotspotId;
      byRoom[pin.roomId].pinScanId = pin.scanId;
    }
    return { itemId: it.id, name: it.name, rooms, pin };
  }).filter((r) => r.rooms.length);
}

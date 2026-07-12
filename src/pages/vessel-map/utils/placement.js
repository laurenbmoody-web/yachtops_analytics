// Physical placement — a map pin IS a node in the vessel_locations tree, and
// an inventory item's physical location is its default_location_id pointing at
// that node. This module resolves a pin to its node (creating the chain
// room > container > … > pin lazily, keyed by stable ids so it's rename-safe)
// and reads/writes the items placed there.
import { supabase } from '../../../lib/supabaseClient';
import { applyPlacement, setPinQty, pinQty, entryKey } from './stockMath';

const ITEM_COLS = 'id, name, unit, quantity, total_qty, location, sub_location, stock_locations';
const readItem = async (itemId) => {
  const { data, error } = await supabase.from('inventory_items').select('stock_locations, total_qty, quantity').eq('id', itemId).single();
  if (error) return { error: error.message || 'Could not load the item.' };
  return { stockLocations: data?.stock_locations || [], total: Number(data?.total_qty ?? data?.quantity) || 0 };
};
const writeStock = (itemId, { stockLocations, totalQty }) =>
  supabase.from('inventory_items').update({ stock_locations: stockLocations, total_qty: totalQty, quantity: totalQty }).eq('id', itemId);

// Find-or-create one vessel_locations node by (parent, name) within the tenant.
async function findOrCreateNode({ tenantId, userId, parentId, name }) {
  const label = (name || 'Untitled').trim();
  let q = supabase
    .from('vessel_locations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('name', label)
    .eq('is_archived', false)
    .limit(1);
  q = parentId ? q.eq('parent_id', parentId) : q.is('parent_id', null);
  const { data: found, error: findErr } = await q;
  if (findErr) return { error: findErr.message || 'Could not read locations.' };
  if (found && found.length) return { id: found[0].id };

  const { data: made, error: makeErr } = await supabase
    .from('vessel_locations')
    .insert({ tenant_id: tenantId, level: 'space', name: label, parent_id: parentId || null, created_by: userId || null })
    .select('id')
    .single();
  if (makeErr) return { error: makeErr.message || 'Could not create the location.' };
  return { id: made.id, created: true };
}

// Resolve (creating if needed) the pin's location node. `trail` is the pin's
// container ancestry (outermost first) as { id, label, location_node_id };
// `pin` is the pin itself. Nodes are cached on each hotspot's location_node_id.
// Returns { nodeId, patched: [{hotspotId, nodeId}] } so the caller can sync
// page state, or { error }.
export async function resolvePinNode({ tenantId, userId, rootSpaceId, rootName, trail = [], pin }) {
  const patched = [];
  let parentId = rootSpaceId || null;
  // If the scan isn't tied to a space, root the tree at a node named for it.
  if (!parentId && rootName) {
    const r = await findOrCreateNode({ tenantId, userId, parentId: null, name: rootName });
    if (r.error) return { error: r.error };
    parentId = r.id;
  }
  // Walk the container chain, caching each node id on its hotspot.
  for (const c of trail) {
    if (c.location_node_id) { parentId = c.location_node_id; continue; }
    const r = await findOrCreateNode({ tenantId, userId, parentId, name: c.label });
    if (r.error) return { error: r.error };
    parentId = r.id;
    patched.push({ hotspotId: c.id, nodeId: r.id });
  }
  // The pin's own node.
  if (pin.location_node_id) return { nodeId: pin.location_node_id, patched };
  const leaf = await findOrCreateNode({ tenantId, userId, parentId, name: pin.label });
  if (leaf.error) return { error: leaf.error };
  patched.push({ hotspotId: pin.id, nodeId: leaf.id });
  // Persist the node ids on the hotspots so we never recreate them.
  for (const p of patched) {
    await supabase.from('scan_hotspots').update({ location_node_id: p.nodeId }).eq('id', p.hotspotId);
  }
  return { nodeId: leaf.id, patched };
}

// Items physically at a node — the pin's contents. Matches items whose
// stock_locations carry an entry for this node; the row's `pinQty` is how many
// are HERE (not the grand total). Category rides along (location/sub_location).
export async function itemsAtNode(tenantId, nodeId) {
  if (!nodeId) return { items: [] };
  const { data, error } = await supabase
    .from('inventory_items')
    .select(ITEM_COLS)
    .eq('tenant_id', tenantId)
    .contains('stock_locations', [{ vesselLocationId: nodeId }])
    .order('name', { ascending: true });
  if (error) return { error: error.message || 'Could not load what’s here.' };
  const items = (data || [])
    .map((it) => ({ ...it, pinQty: pinQty(it.stock_locations, nodeId) }))
    .filter((it) => it.pinQty > 0);
  return { items };
}

// An item's stock breakdown, for the transfer panel (where it is + total).
export async function itemStock(itemId) {
  const r = await readItem(itemId);
  if (r.error) return { error: r.error };
  return { stockLocations: r.stockLocations, total: r.total };
}

// Receive new stock at the pin and/or move existing stock in from elsewhere.
// `addNew` raises the total; `moves` ([{key, qty}]) just relocate. pin = {nodeId, name}.
export async function placeStock(itemId, { pin, addNew = 0, moves = [] }) {
  const r = await readItem(itemId);
  if (r.error) return { error: r.error };
  const next = applyPlacement({ stockLocations: r.stockLocations, total: r.total }, { pin, addNew, moves });
  const { error } = await writeStock(itemId, next);
  if (error) return { error: error.message || 'Could not place the stock.' };
  return {};
}

// Recount how many are on the pin now (the −/+). The change hits the total.
export async function setPinCount(itemId, { pin, newQty }) {
  const r = await readItem(itemId);
  if (r.error) return { error: r.error };
  const next = setPinQty({ stockLocations: r.stockLocations, total: r.total }, { pin, newQty });
  const { error } = await writeStock(itemId, next);
  if (error) return { error: error.message || 'Could not save the count.' };
  return {};
}

// Take an item off the pin — drop the pin's stock entry back into "unplaced"
// (total unchanged; the item isn't deleted, just no longer sitting here).
export async function clearItemNode(itemId, pin) {
  const r = await readItem(itemId);
  if (r.error) return { error: r.error };
  const kept = (r.stockLocations || []).filter((e) => entryKey(e) !== pin.nodeId);
  const { error } = await supabase.from('inventory_items')
    .update({ stock_locations: kept.map((e) => ({ ...e, quantity: Number(e.qty ?? e.quantity) || 0 })) })
    .eq('id', itemId);
  if (error) return { error: error.message || 'Could not remove the item.' };
  return {};
}

// Create a brand-new inventory item, all of it received AT the pin.
// `category` (an inventory_locations folder) files it in the inventory tree.
export async function createItemAtNode({ tenantId, userId, name, qty, unit, pin, category }) {
  const n = Number(qty);
  const quantity = Number.isFinite(n) && n >= 0 ? n : 0;
  const stock = quantity > 0
    ? [{ vesselLocationId: pin.nodeId, locationId: pin.nodeId, locationName: pin.name || '', subLocation: pin.name || '', qty: quantity, quantity }]
    : [];
  const { data, error } = await supabase
    .from('inventory_items')
    .insert({
      tenant_id: tenantId,
      name: (name || '').trim(),
      quantity,
      total_qty: quantity,
      unit: unit || null,
      location: category?.location || null,
      sub_location: category?.sub_location || null,
      stock_locations: stock,
      created_by: userId || null,
    })
    .select(ITEM_COLS)
    .single();
  if (error) return { error: error.message || 'Could not create the item.' };
  return { item: data };
}

// Human-readable path of a node ("Main Galley › test › Dry Store › Shelf 1").
export async function nodePath(nodeId) {
  if (!nodeId) return { path: '' };
  const names = [];
  let cur = nodeId;
  for (let i = 0; i < 12 && cur; i++) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase.from('vessel_locations').select('name, parent_id').eq('id', cur).single();
    if (error || !data) break;
    names.unshift(data.name);
    cur = data.parent_id;
  }
  return { path: names.join(' › ') };
}

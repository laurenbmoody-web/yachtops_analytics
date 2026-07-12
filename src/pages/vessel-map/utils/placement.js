// Physical placement — a map pin IS a node in the vessel_locations tree, and
// an inventory item's physical location is its default_location_id pointing at
// that node. This module resolves a pin to its node (creating the chain
// room > container > … > pin lazily, keyed by stable ids so it's rename-safe)
// and reads/writes the items placed there.
import { supabase } from '../../../lib/supabaseClient';

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

// Items physically at a node — the pin's contents. Category comes along on the
// row (location/sub_location = the item's inventory folder).
export async function itemsAtNode(tenantId, nodeId) {
  if (!nodeId) return { items: [] };
  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, name, quantity, unit, total_qty, location, sub_location, default_location_id')
    .eq('tenant_id', tenantId)
    .eq('default_location_id', nodeId)
    .order('name', { ascending: true });
  if (error) return { error: error.message || 'Could not load what’s here.' };
  return { items: data || [] };
}

// Place an existing item at a node (set its physical location). Returns the
// item's prior default_location_id so the caller can offer a "move" undo/warn.
export async function placeItemAtNode(itemId, nodeId) {
  const { error } = await supabase.from('inventory_items').update({ default_location_id: nodeId }).eq('id', itemId);
  if (error) return { error: error.message || 'Could not place the item.' };
  return {};
}

// Remove an item from a pin — clears its physical location (doesn't delete it).
export async function clearItemNode(itemId) {
  const { error } = await supabase.from('inventory_items').update({ default_location_id: null }).eq('id', itemId);
  if (error) return { error: error.message || 'Could not remove the item.' };
  return {};
}

// Create a brand-new inventory item, physically here — the on-the-map add.
// Category (its inventory folder) is left blank; the crew can file it later.
export async function createItemAtNode({ tenantId, userId, name, qty, unit, nodeId }) {
  const n = Number(qty);
  const quantity = Number.isFinite(n) && n >= 0 ? n : 0;
  const { data, error } = await supabase
    .from('inventory_items')
    .insert({
      tenant_id: tenantId,
      name: (name || '').trim(),
      quantity,
      total_qty: quantity,
      unit: unit || null,
      default_location_id: nodeId,
      created_by: userId || null,
    })
    .select('id, name, quantity, unit, total_qty, location, sub_location, default_location_id')
    .single();
  if (error) return { error: error.message || 'Could not create the item.' };
  return { item: data };
}

// The quick-check count — the item's quantity here (it lives at one node, so
// its quantity IS the count). Writes quantity + total_qty together.
export async function setItemQuantity(itemId, qty) {
  const n = Math.max(0, Number(qty) || 0);
  const { error } = await supabase.from('inventory_items').update({ quantity: n, total_qty: n }).eq('id', itemId);
  if (error) return { error: error.message || 'Could not save the count.' };
  return {};
}

// Where an item currently is (for the "currently at X — move here?" check).
export async function itemPlacement(itemId) {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('default_location_id')
    .eq('id', itemId)
    .single();
  if (error) return { error: error.message };
  return { nodeId: data?.default_location_id || null };
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

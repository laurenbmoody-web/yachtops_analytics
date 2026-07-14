// Physical placement — a map pin IS a node in the vessel_locations tree, and
// an inventory item's physical location is its default_location_id pointing at
// that node. This module resolves a pin to its node (creating the chain
// room > container > … > pin lazily, keyed by stable ids so it's rename-safe)
// and reads/writes the items placed there.
import { supabase } from '../../../lib/supabaseClient';
import { applyPlacement, setPinQty, pinQty, entryKey } from './stockMath';
import { logReceived, logMoved, logCounted, logRemoved, logCreated } from './movementLog';
// The node resolver lives in the shared physical-location tree module so the map,
// the inventory picker, and Location Management all resolve one place to one row.
import { resolvePinNode, getNodePath } from '../../../utils/locationTree';
import { findExistingItem } from '../../../utils/itemIdentity';

// Back-compat re-exports — existing importers (PinItems) pull these from here.
export { resolvePinNode };
export { getNodePath as nodePath };

const ITEM_COLS = 'id, name, unit, quantity, total_qty, location, sub_location, stock_locations';
// Read what we need to mutate stock AND to write a readable movement-log line
// (name + department ride along so the log entry is self-describing).
const readItem = async (itemId) => {
  const { data, error } = await supabase.from('inventory_items').select('name, usage_department, stock_locations, total_qty, quantity').eq('id', itemId).single();
  if (error) return { error: error.message || 'Could not load the item.' };
  return {
    name: data?.name || '',
    department: data?.usage_department || null,
    stockLocations: data?.stock_locations || [],
    total: Number(data?.total_qty ?? data?.quantity) || 0,
  };
};
const writeStock = (itemId, { stockLocations, totalQty }) =>
  supabase.from('inventory_items').update({ stock_locations: stockLocations, total_qty: totalQty, quantity: totalQty }).eq('id', itemId);

// Items physically at a node — the pin's contents. Matches items whose
// stock_locations carry an entry for this node; the row's `pinQty` is how many
// are HERE (not the grand total). Category rides along (location/sub_location).
export async function itemsAtNode(tenantId, nodeId) {
  if (!nodeId) return { items: [] };
  // stock_locations is jsonb — pass the containment probe as a JSON STRING, or
  // supabase-js serializes a JS array as a Postgres array literal ({…}) and
  // Postgres rejects it ("invalid input syntax for type json").
  const { data, error } = await supabase
    .from('inventory_items')
    .select(ITEM_COLS)
    .eq('tenant_id', tenantId)
    .contains('stock_locations', JSON.stringify([{ vesselLocationId: nodeId }]))
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
  // Resolve each source's label + available qty from the PRE-write stock so the
  // log reads "…from Main Galley" and never overstates what actually moved.
  const srcOf = (key) => {
    if (key === '__unplaced__') return { label: 'Unplaced', avail: Infinity };
    const e = (r.stockLocations || []).find((x) => entryKey(x) === key);
    return { label: (e && (e.locationName || e.subLocation)) || 'Location', avail: e ? (Number(e.qty ?? e.quantity) || 0) : 0 };
  };
  const next = applyPlacement({ stockLocations: r.stockLocations, total: r.total }, { pin, addNew, moves });
  const { error } = await writeStock(itemId, next);
  if (error) return { error: error.message || 'Could not place the stock.' };
  const item = { id: itemId, name: r.name, usage_department: r.department };
  logReceived(item, { qty: Number(addNew) || 0, pinName: pin.name, nodeId: pin.nodeId });
  for (const m of moves) {
    const src = srcOf(m.key);
    const qty = Math.min(Math.max(0, Number(m.qty) || 0), src.avail);
    logMoved(item, { qty, fromLabel: src.label, fromKey: m.key, pinName: pin.name, nodeId: pin.nodeId });
  }
  return {};
}

// Recount how many are on the pin now (the −/+). The change hits the total.
export async function setPinCount(itemId, { pin, newQty }) {
  const r = await readItem(itemId);
  if (r.error) return { error: r.error };
  const before = pinQty(r.stockLocations, pin.nodeId);
  const to = Math.max(0, Number(newQty) || 0);
  const next = setPinQty({ stockLocations: r.stockLocations, total: r.total }, { pin, newQty });
  const { error } = await writeStock(itemId, next);
  if (error) return { error: error.message || 'Could not save the count.' };
  logCounted({ id: itemId, name: r.name, usage_department: r.department }, { from: before, to, pinName: pin.name, nodeId: pin.nodeId });
  return {};
}

// Take an item off the pin — drop the pin's stock entry back into "unplaced"
// (total unchanged; the item isn't deleted, just no longer sitting here).
export async function clearItemNode(itemId, pin) {
  const r = await readItem(itemId);
  if (r.error) return { error: r.error };
  const removedQty = pinQty(r.stockLocations, pin.nodeId);
  const kept = (r.stockLocations || []).filter((e) => entryKey(e) !== pin.nodeId);
  const { error } = await supabase.from('inventory_items')
    .update({ stock_locations: kept.map((e) => ({ ...e, quantity: Number(e.qty ?? e.quantity) || 0 })) })
    .eq('id', itemId);
  if (error) return { error: error.message || 'Could not remove the item.' };
  logRemoved({ id: itemId, name: r.name, usage_department: r.department }, { qty: removedQty, pinName: pin.name, nodeId: pin.nodeId });
  return {};
}

// Create a brand-new inventory item, all of it received AT the pin.
// `category` (an inventory_locations folder) files it in the inventory tree.
//
// Dedupe: unless `force`, first look for an existing item of the same name in
// the tenant. On a hit we DON'T insert — we return { existing } so the caller
// can confirm (add stock to it) rather than silently spawning a duplicate.
export async function createItemAtNode({ tenantId, userId, name, qty, unit, pin, category, force = false }) {
  const clean = (name || '').trim();
  if (!force) {
    const { item } = await findExistingItem(tenantId, { name: clean });
    if (item) return { existing: item };
  }
  const n = Number(qty);
  const quantity = Number.isFinite(n) && n >= 0 ? n : 0;
  const stock = quantity > 0
    ? [{ vesselLocationId: pin.nodeId, locationId: pin.nodeId, locationName: pin.name || '', subLocation: pin.name || '', qty: quantity, quantity }]
    : [];
  // Always file the item somewhere the inventory browse can see it — the folder
  // dashboard groups by `location`, so an item with no category would vanish.
  // Fall back to "Unfiled › Map" (two segments satisfy the department-folder guard).
  const location = category?.location || 'Unfiled';
  const subLocation = category?.sub_location || (category?.location ? null : 'Map');
  const { data, error } = await supabase
    .from('inventory_items')
    .insert({
      tenant_id: tenantId,
      name: clean,
      quantity,
      total_qty: quantity,
      unit: unit || null,
      location,
      sub_location: subLocation,
      stock_locations: stock,
      default_location_id: pin.nodeId || null,
      created_by: userId || null,
    })
    .select(ITEM_COLS)
    .single();
  if (error) return { error: error.message || 'Could not create the item.' };
  logCreated({ id: data.id, name: data.name }, { qty: quantity, pinName: pin.name, nodeId: pin.nodeId });
  return { item: data };
}

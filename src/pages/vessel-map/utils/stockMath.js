// Pure inventory stock-location arithmetic — no I/O, so it's unit-testable.
//
// An item's `total_qty` is split across `stock_locations` entries (each pinned
// to a place by vesselLocationId/locationId, or by name for legacy rows). Any
// remainder not in an entry is "unplaced". A map pin is just one more place
// (keyed by its vessel_locations node id). Two operations:
//   • placement — receive NEW stock at the pin (raises the total) and/or MOVE
//     existing stock in from other places (total unchanged);
//   • recount — set exactly how many are on the pin now (delta hits the total).

const num = (v) => Number(v ?? 0) || 0;

// Stable key for a stock_locations entry.
export function entryKey(e) {
  return e.vesselLocationId || e.locationId || `name:${(e.locationName || '').trim()}|${(e.subLocation || '').trim()}`;
}

function pinEntry(pin, qty) {
  return {
    vesselLocationId: pin.nodeId, locationId: pin.nodeId,
    locationName: pin.name || '', subLocation: pin.name || '',
    qty, quantity: qty,
  };
}

const normalize = (stockLocations) =>
  (stockLocations || []).map((e) => ({ ...e, qty: num(e.qty ?? e.quantity) }));

const finish = (arr, totalQty) => ({
  stockLocations: arr.filter((e) => e.qty > 0).map((e) => ({ ...e, qty: e.qty, quantity: e.qty })),
  totalQty: Math.max(0, totalQty),
});

// How many of the item sit on this pin now.
export function pinQty(stockLocations, nodeId) {
  const e = (stockLocations || []).find((x) => entryKey(x) === nodeId);
  return e ? num(e.qty ?? e.quantity) : 0;
}

// Places you could move stock FROM (excluding the pin itself), plus the
// unplaced remainder as a synthetic "Unplaced" source. [{ key, label, qty }].
export function sources({ stockLocations = [], total = 0 }, pinNodeId) {
  const placed = normalize(stockLocations)
    .filter((e) => e.qty > 0 && entryKey(e) !== pinNodeId)
    .map((e) => ({ key: entryKey(e), label: e.locationName || e.subLocation || 'Location', qty: e.qty }));
  const placedTotal = normalize(stockLocations).reduce((s, e) => s + e.qty, 0);
  const unplaced = Math.max(0, num(total) - placedTotal);
  if (unplaced > 0) placed.push({ key: '__unplaced__', label: 'Unplaced', qty: unplaced });
  return placed;
}

// Apply a placement: `addNew` received at the pin (raises total) + `moves`
// pulled from other places (total unchanged). moves: [{ key, qty }] where key
// is a source key from sources() (or '__unplaced__'). Returns { stockLocations,
// totalQty }.
export function applyPlacement({ stockLocations = [], total = 0 }, { pin, addNew = 0, moves = [] }) {
  const arr = normalize(stockLocations);
  const add = Math.max(0, num(addNew));
  let moved = 0;
  for (const m of moves) {
    const q = Math.max(0, num(m.qty));
    if (q <= 0) continue;
    if (m.key === '__unplaced__') { moved += q; continue; } // from the unplaced remainder
    const e = arr.find((x) => entryKey(x) === m.key);
    if (e) { const take = Math.min(q, e.qty); e.qty -= take; moved += take; }
  }
  const delta = add + moved;
  const pe = arr.find((x) => entryKey(x) === pin.nodeId);
  if (pe) pe.qty += delta;
  else if (delta > 0) arr.push(pinEntry(pin, delta));
  return finish(arr, num(total) + add); // moves are internal; only new stock changes the total
}

// Recount: set the pin's count to `newQty`. The change flows to the total (a
// recount means the real-world stock changed).
export function setPinQty({ stockLocations = [], total = 0 }, { pin, newQty }) {
  const arr = normalize(stockLocations);
  const target = Math.max(0, num(newQty));
  const pe = arr.find((x) => entryKey(x) === pin.nodeId);
  const cur = pe ? pe.qty : 0;
  if (pe) pe.qty = target;
  else if (target > 0) arr.push(pinEntry(pin, target));
  return finish(arr, num(total) + (target - cur));
}

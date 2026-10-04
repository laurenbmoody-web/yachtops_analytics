// A pending stock change ("+1 in the bar fridge") laid over an inventory_items
// row — the same rules as the adjust_inventory_stock server function, so what
// crew see offline is what the server will make of it.
//
// args: { p_delta, p_location_id, p_location_index, p_location_name }
//
// Pure — unit-tested in overlay.test.mjs.

const nameOf = (e) => e?.locationName ?? e?.location_name ?? e?.name ?? '';
const qtyOf = (e) => Number(e?.qty ?? e?.quantity ?? 0) || 0;

export function applyStockDelta(row, args) {
  const delta = Number(args?.p_delta) || 0;
  const locs = row?.stock_locations;
  if (!Array.isArray(locs)) {
    // Read without the stock array: move the total only.
    if (!('quantity' in row) && !('total_qty' in row)) return row;
    const total = Math.max(0, Number(row.quantity ?? row.total_qty ?? 0) + delta);
    const next = { ...row };
    if ('quantity' in row) next.quantity = total;
    if ('total_qty' in row) next.total_qty = total;
    return next;
  }
  if (locs.length === 0) {
    const total = Math.max(0, Number(row.quantity ?? 0) + delta);
    return { ...row, quantity: total, ...('total_qty' in row ? { total_qty: total } : {}) };
  }
  let idx = -1;
  if (args?.p_location_id) {
    idx = locs.findIndex((e) => (e?.vesselLocationId || e?.locationId || '') === args.p_location_id);
  }
  const i = args?.p_location_index;
  if (idx < 0 && Number.isInteger(i) && i >= 0 && i < locs.length && nameOf(locs[i]) === (args?.p_location_name ?? '')) idx = i;
  if (idx < 0 && args?.p_location_name) idx = locs.findIndex((e) => nameOf(e) === args.p_location_name);
  if (idx < 0) return row; // the server will refuse it too

  const entry = locs[idx];
  const q = Math.max(0, qtyOf(entry) + delta);
  const nextEntry = { ...entry, qty: q, ...('quantity' in (entry || {}) ? { quantity: q } : {}) };
  const nextLocs = locs.map((e, j) => (j === idx ? nextEntry : e));
  const total = nextLocs.reduce((s, e) => s + qtyOf(e), 0);
  const next = { ...row, stock_locations: nextLocs };
  if ('quantity' in row) next.quantity = total;
  if ('total_qty' in row) next.total_qty = total;
  return next;
}

// Shared product-identity lookup so the vessel map and inventory converge on ONE
// inventory_items row instead of quietly creating duplicates.
//
// "Same product" is detected barcode-first (exact, case-insensitive) then by
// exact case-insensitive name within the tenant. It only DETECTS — callers decide
// what to do (the add flows surface a confirm: add-to-existing vs create-new), so
// two different products that happen to share a name are never silently merged.
import { supabase } from '../lib/supabaseClient';

// Columns a caller needs to then place stock / merge into the matched item.
const MATCH_COLS = 'id, name, barcode, location, sub_location, stock_locations, total_qty, quantity, unit';

// Look for an existing item. Returns { item, matchedBy: 'barcode' | 'name' } on a
// hit, or { item: null }. Barcode wins over name.
export async function findExistingItem(tenantId, { barcode, name } = {}) {
  if (!tenantId) return { item: null };

  const bc = (barcode || '').trim();
  if (bc) {
    const { data, error } = await supabase
      .from('inventory_items')
      .select(MATCH_COLS)
      .eq('tenant_id', tenantId)
      .ilike('barcode', bc) // exact value, case-insensitive (no wildcards)
      .limit(1);
    if (!error && data && data.length) return { item: data[0], matchedBy: 'barcode' };
  }

  const nm = (name || '').trim();
  if (nm) {
    const { data, error } = await supabase
      .from('inventory_items')
      .select(MATCH_COLS)
      .eq('tenant_id', tenantId)
      .ilike('name', nm) // exact name, case-insensitive
      .limit(1);
    if (!error && data && data.length) return { item: data[0], matchedBy: 'name' };
  }

  return { item: null };
}

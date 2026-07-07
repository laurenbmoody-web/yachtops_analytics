// Marketplace (Phase 2) data layer — vessel-side browsing of Cargo
// supplier catalogues and basket → provisioning-board handoff.
//
// Supplier discovery goes through the get_marketplace_suppliers RPC
// (SECURITY DEFINER; safe storefront columns only — the raw
// supplier_profiles row is crew-invisible for marketplace suppliers
// and carries bank/tax fields anyway). Catalogue items are read
// directly: crew_read_supplier_catalogue already grants active tenant
// members SELECT on all catalogues.

import { supabase } from '../../../lib/supabaseClient';

export const fetchMarketplaceSuppliers = async () => {
  const { data, error } = await supabase.rpc('get_marketplace_suppliers');
  if (error) throw error;
  return data ?? [];
};

/**
 * Honest per-supplier trust KPIs for the Providers wall — orders
 * filled, on-time %, and typical response time, all derived from real
 * order history (get_marketplace_supplier_stats RPC). Returns a Map
 * keyed by supplier id with a normalised shape; the caller renders a
 * "New to Cargo" state where orders_count is 0. Best-effort: a stats
 * failure must never stop the marketplace loading.
 */
export const fetchMarketplaceSupplierStats = async () => {
  try {
    const { data, error } = await supabase.rpc('get_marketplace_supplier_stats');
    if (error) throw error;
    const map = new Map();
    (data ?? []).forEach((r) => {
      const orders = Number(r.orders_count) || 0;
      const otElig = Number(r.on_time_eligible) || 0;
      const otCount = Number(r.on_time_count) || 0;
      map.set(r.supplier_profile_id, {
        orders,
        fulfilled: Number(r.orders_fulfilled) || 0,
        onTimePct: otElig > 0 ? Math.round((otCount / otElig) * 100) : null,
        onTimeSample: otElig,
        responseHours: r.avg_response_hours != null ? Number(r.avg_response_hours) : null,
        lastOrderAt: r.last_order_at || null,
      });
    });
    return map;
  } catch (err) {
    console.warn('[marketplaceStorage] fetchMarketplaceSupplierStats (non-blocking):', err?.message);
    return new Map();
  }
};

/**
 * All active catalogue items for the given marketplace suppliers.
 * No supplier_profiles embed — RLS would null it out for crew; the
 * caller joins names client-side from fetchMarketplaceSuppliers().
 */
export const fetchMarketplaceProducts = async (supplierIds) => {
  if (!supplierIds?.length) return [];
  const { data, error } = await supabase
    .from('supplier_catalogue_items')
    .select('id, supplier_id, name, sku, barcode, category, unit, pack_size, pack_unit, unit_size, unit_price, currency, description, in_stock, stock_qty, image_url, updated_at, reorder_point, lead_time_days, min_order_qty')
    .in('supplier_id', supplierIds)
    .eq('active', true)
    .order('name', { ascending: true });
  if (error) throw error;
  return data ?? [];
};

/**
 * Reference coordinates for known yacht ports, keyed by lower-case name.
 * Powers the marketplace map's pins, radius circles, and distance filter.
 * Best-effort: a failure just means the map falls back to name matching.
 */
export const fetchPortLocations = async () => {
  try {
    const { data, error } = await supabase
      .from('port_locations')
      .select('name, lat, lng, country, region');
    if (error) throw error;
    const map = new Map();
    (data ?? []).forEach((p) => {
      map.set(String(p.name).toLowerCase(), {
        name: p.name, lat: Number(p.lat), lng: Number(p.lng), country: p.country, region: p.region,
      });
    });
    return map;
  } catch (err) {
    console.warn('[marketplaceStorage] fetchPortLocations (non-blocking):', err?.message);
    return new Map();
  }
};

/** Which marketplace suppliers this tenant already works with. */
export const fetchTenantSupplierIds = async (tenantId) => {
  if (!tenantId) return new Set();
  const { data, error } = await supabase
    .from('tenant_suppliers')
    .select('supplier_id, status')
    .eq('tenant_id', tenantId);
  if (error) return new Set();
  return new Set((data ?? []).filter(r => r.status !== 'blocked').map(r => r.supplier_id));
};

/**
 * First order from a new supplier creates the relationship row —
 * deliberately frictionless (see Phase 2 design). Best-effort: a
 * failure here must never block the basket landing on the board.
 */
export const ensureTenantSupplierLinks = async (tenantId, supplierIds) => {
  if (!tenantId || !supplierIds?.length) return;
  try {
    const rows = supplierIds.map(id => ({ tenant_id: tenantId, supplier_id: id }));
    await supabase
      .from('tenant_suppliers')
      .upsert(rows, { onConflict: 'tenant_id,supplier_id', ignoreDuplicates: true });
  } catch (err) {
    console.warn('[marketplaceStorage] ensureTenantSupplierLinks (non-blocking):', err?.message);
  }
};

// ── Supplier catalogue category → vessel taxonomy ───────────────────────────
// Supplier catalogues use 8 flat categories; boards use the per-department
// lists in data/categories.js. Keyword nudges catch the cases where the
// flat category is coarser than the vessel taxonomy (fish vs meat,
// alcoholic vs soft). Crew can always recategorise on the board.

const FISH_RE = /\b(fish|seafood|prawn|shrimp|lobster|crab|oyster|mussel|clam|caviar|tuna|salmon|seabass|sole|turbot|squid|octopus|scallop)\b/i;
const ALCOHOL_RE = /\b(wine|ros[eé]|champagne|prosecco|beer|lager|ale|gin|vodka|whisky|whiskey|rum|tequila|liqueur|vermouth|ap[ée]ritif|brut|blanc)\b/i;

export const mapCatalogueCategory = (product) => {
  const name = `${product?.name || ''} ${product?.description || ''}`;
  switch (product?.category) {
    // Food & beverage → Galley
    case 'Produce':     return { category: 'Fresh Produce', department: 'Galley' };
    case 'Meat & Fish': return { category: FISH_RE.test(name) ? 'Fish & Seafood' : 'Meat & Poultry', department: 'Galley' };
    case 'Dairy':       return { category: 'Dairy & Eggs', department: 'Galley' };
    case 'Bakery':      return { category: 'Bakery', department: 'Galley' };
    case 'Beverages':   return { category: ALCOHOL_RE.test(name) ? 'Beverages — Alcoholic' : 'Beverages — Non-Alcoholic', department: 'Galley' };
    case 'Alcohol & Wine': return { category: 'Beverages — Alcoholic', department: 'Galley' };
    case 'Dry Goods':   return { category: 'Pantry & Dry Goods', department: 'Galley' };
    case 'Frozen':      return { category: 'Frozen', department: 'Galley' };
    case 'Snacks & Confectionery': return { category: 'BBQ & Snacks', department: 'Galley' };
    case 'Cleaning':    return { category: 'Cleaning', department: 'Galley' };
    // Wider verticals → their departments
    case 'Interior & Guest Supplies': return { category: 'Guest Supplies', department: 'Interior' };
    case 'Flowers & Decor':           return { category: 'Floral & Decor', department: 'Interior' };
    case 'Deck & Exterior':           return { category: 'Deck Consumables & Hardware', department: 'Deck' };
    case 'Engineering & Spares':      return { category: 'Spare Parts — Other', department: 'Engineering' };
    case 'Safety & Medical':          return { category: 'Safety & Life-Saving Equipment', department: 'Deck' };
    case 'Water Sports & Toys':       return { category: 'Water Sports & Toys', department: 'Deck' };
    case 'Uniform & Crew Wear':       return { category: 'Uniforms & Crew Clothing', department: 'Interior' };
    case 'IT & Electronics':          return { category: 'IT, AV & Communications', department: 'Bridge' };
    // Custom supplier categories pass through untouched so the board
    // shows the supplier's own heading; department defaults to Galley
    // and crew can rehome the line.
    default:
      return { category: product?.category || 'Galley Consumables', department: 'Galley' };
  }
};

/**
 * Land basket lines on a board as normal draft provisioning lines —
 * pre-priced, supplier-assigned, carrying the catalogue link. lines:
 * [{ product, qty }]. Returns the created provisioning_items rows.
 */
export const addBasketToBoard = async (listId, lines) => {
  if (!listId || !lines?.length) return [];
  const payload = lines.map(({ product, qty }) => {
    const mapped = mapCatalogueCategory(product);
    return {
      list_id: listId,
      name: product.name,
      size: product.unit_size || null,
      category: mapped.category,
      department: mapped.department,
      quantity_ordered: qty,
      unit: product.unit || 'each',
      units_per_pack: product.pack_size || null,
      estimated_unit_cost: product.unit_price ?? null,
      supplier_profile_id: product.supplier_id,
      catalogue_item_id: product.id,
      source: 'catalogue',
      status: 'draft',
    };
  });
  const { data, error } = await supabase
    .from('provisioning_items')
    .insert(payload)
    .select();
  if (error) throw error;
  return data ?? [];
};

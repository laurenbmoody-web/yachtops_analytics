// Inventory Items Storage - Supabase-backed, Location-First Schema
import { supabase } from '../../../lib/supabaseClient';
import { getCurrentUser } from '../../../utils/authStorage';
import { logActivity, InventoryActions } from '../../../utils/activityStorage';

const getActiveTenantId = () =>
  localStorage.getItem('cargo_active_tenant_id') ||
  localStorage.getItem('activeTenantId') ||
  null;


// Map DB row → JS object
const rowToItem = (row) => {
  if (!row) return null;

  // Normalize each stock location object to a consistent client shape:
  // { locationId, vesselLocationId, locationName, qty }
  // Supports all historical key variants: locationName, location_name, name, qty, quantity
  const normalizeStockLocations = (rawLocations) => {
    if (!Array.isArray(rawLocations)) return [];
    return rawLocations?.map(loc => {
      if (!loc) return null;
      const locationName =
        loc?.locationName ||
        loc?.location_name ||
        loc?.name ||
        '';
      const qty =
        loc?.qty !== undefined && loc?.qty !== null
          ? loc?.qty
          : loc?.quantity !== undefined && loc?.quantity !== null
          ? loc?.quantity
          : 0;
      return {
        ...loc,
        locationId: loc?.locationId || loc?.vesselLocationId || '',
        vesselLocationId: loc?.vesselLocationId || loc?.locationId || '',
        locationName,
        qty,
      };
    })?.filter(Boolean);
  };

  const stockLocations = normalizeStockLocations(row?.stock_locations);
  const computedTotalQty = stockLocations?.length > 0
    ? stockLocations?.reduce((sum, loc) => sum + (loc?.qty ?? 0), 0)
    : (row?.total_qty ?? row?.quantity ?? 0);

  return {
    id: row?.id,
    cargoItemId: row?.cargo_item_id || null,
    tenantId: row?.tenant_id,
    createdBy: row?.created_by,
    updatedBy: row?.updated_by,
    // Location-first fields
    location: row?.location || '',
    subLocation: row?.sub_location || '',
    tags: row?.tags || [],
    // Core fields
    name: row?.name || '',
    unit: row?.unit || 'each',
    size: row?.size || '',
    quantity: row?.quantity ?? row?.totalQty ?? 0,
    totalQty: computedTotalQty,
    notes: row?.notes || '',
    // Extended metadata
    description: row?.description || '',
    brand: row?.brand || '',
    year: row?.year ?? null,
    tastingNotes: row?.tasting_notes || '',
    barcode: row?.barcode || '',
    expiryDate: row?.expiry_date || null,
    defaultLocationId: row?.default_location_id || '',
    // Custom structured fields (colour, batch_no, etc.)
    customFields: row?.custom_fields || {},
    // Legacy taxonomy (kept for backward compat)
    l1Id: row?.l1_id,
    l2Id: row?.l2_id,
    l3Id: row?.l3_id,
    l4Id: row?.l4_id,
    l1Name: row?.l1_name,
    l2Name: row?.l2_name,
    l3Name: row?.l3_name,
    l4Name: row?.l4_name,
    usageDepartment: row?.usage_department,
    stockLocations,
    parLevel: row?.par_level,
    reorderPoint: row?.reorder_point,
    restockEnabled: row?.restock_enabled,
    restockLevel: row?.restock_level,
    unitCost: row?.unit_cost,
    currency: row?.currency || 'USD',
    imageUrl: row?.image_url,
    supplier: row?.supplier,
    condition: row?.condition,
    icon: row?.icon || null,
    color: row?.color || null,
    partialBottle: row?.partial_bottle ?? null,
    createdAt: row?.created_at,
    updatedAt: row?.updated_at,
  };
};

// Returns a valid ISO date string or null — prevents non-date strings (e.g. "EXPIRES") from reaching Postgres
const sanitizeDate = (value) => {
  if (!value) return null;
  const str = String(value)?.trim();
  if (!str) return null;

  // Already ISO format YYYY-MM-DD — return as-is
  if (/^\d{4}-\d{2}-\d{2}$/?.test(str)) return str;

  // ISO datetime string with time component (e.g. "2026-03-15T00:00:00.000Z", "2026-03-15 00:00:00")
  // SheetJS with cellDates:true can produce these
  const isoDatetime = str?.match(/^(\d{4}-\d{2}-\d{2})[T ][\d:.Z+-]/);
  if (isoDatetime) return isoDatetime?.[1];

  // Excel date serial number (e.g. "45366") — 5-digit integer
  // SheetJS sometimes outputs the raw serial when the cell format is unrecognised
  const serialMatch = str?.match(/^(\d{5})$/);
  if (serialMatch) {
    const serial = parseInt(serialMatch?.[1], 10);
    // Excel epoch: Jan 0 1900 (serial 1 = Jan 1 1900). JS epoch offset = serial - 25569 days from 1970-01-01
    const msFromEpoch = (serial - 25569) * 86400 * 1000;
    const d = new Date(msFromEpoch);
    if (!isNaN(d?.getTime()) && d?.getFullYear() >= 1900 && d?.getFullYear() <= 2100) {
      return d?.toISOString()?.split('T')?.[0];
    }
  }

  // Handle numeric date with slashes or dashes: could be DD/MM/YYYY or M/D/YYYY
  // Strategy: if first number > 12 it must be a day; if second number > 12 it must be a day (US format M/D/YYYY)
  const numericDate = str?.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (numericDate) {
    const a = parseInt(numericDate?.[1], 10);
    const b = parseInt(numericDate?.[2], 10);
    let year = parseInt(numericDate?.[3], 10);

    let day, month;
    if (a > 12 && b <= 12) {
      // First number can't be a month → DD/MM/YYYY
      day = a; month = b;
    } else if (b > 12 && a <= 12) {
      // Second number can't be a month → M/D/YYYY (US)
      month = a; day = b;
    } else {
      // Ambiguous — default to DD/MM/YYYY (UK convention for this app)
      day = a; month = b;
    }

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(year, month - 1, day);
      if (!isNaN(d?.getTime())) {
        return `${year}-${String(month)?.padStart(2, '0')}-${String(day)?.padStart(2, '0')}`;
      }
    }
  }

  // Handle DD Month YYYY (e.g. "25 March 2028", "1 Jan 2026")
  const ddMonthYyyy = str?.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (ddMonthYyyy) {
    let day = parseInt(ddMonthYyyy?.[1], 10);
    const monthStr = ddMonthYyyy?.[2];
    let year = parseInt(ddMonthYyyy?.[3], 10);
    const parsed = new Date(`${monthStr} ${day}, ${year}`);
    if (!isNaN(parsed?.getTime())) {
      return `${year}-${String(parsed?.getMonth() + 1)?.padStart(2, '0')}-${String(day)?.padStart(2, '0')}`;
    }
  }

  // Handle DD-Mon-YY or DD-Mon-YYYY (e.g. "30-Sep-26", "31-Dec-99", "30-Sep-2026")
  const ddMonYy = str?.match(/^(\d{1,2})[\/\-]([A-Za-z]{3,9})[\/\-](\d{2,4})$/);
  if (ddMonYy) {
    let day = parseInt(ddMonYy?.[1], 10);
    const monthStr = ddMonYy?.[2];
    let year = parseInt(ddMonYy?.[3], 10);
    // 2-digit year: 00-49 → 2000-2049, 50-99 → 1950-1999
    if (year < 100) year = year < 50 ? 2000 + year : 1900 + year;
    const parsed = new Date(`${monthStr} ${day}, ${year}`);
    if (!isNaN(parsed?.getTime())) {
      return `${year}-${String(parsed?.getMonth() + 1)?.padStart(2, '0')}-${String(day)?.padStart(2, '0')}`;
    }
  }

  // Handle Mon-YY or Mon-YYYY (e.g. "Sep-26", "Dec-2026")
  const monYy = str?.match(/^([A-Za-z]{3,9})[\/\-](\d{2,4})$/);
  if (monYy) {
    const monthStr = monYy?.[1];
    let year = parseInt(monYy?.[2], 10);
    if (year < 100) year = year < 50 ? 2000 + year : 1900 + year;
    const parsed = new Date(`${monthStr} 1, ${year}`);
    if (!isNaN(parsed?.getTime())) {
      return `${year}-${String(parsed?.getMonth() + 1)?.padStart(2, '0')}-01`;
    }
  }

  // Handle MM/YYYY or MM-YYYY format (e.g. "01/2025", "12-2025")
  const mmYyyy = str?.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (mmYyyy) {
    let month = parseInt(mmYyyy?.[1], 10);
    let year = parseInt(mmYyyy?.[2], 10);
    if (month >= 1 && month <= 12) {
      return `${year}-${String(month)?.padStart(2, '0')}-01`;
    }
  }

  // Handle MM/YY or MM-YY format (e.g. "01/25", "12-25")
  const mmYy = str?.match(/^(\d{1,2})[\/\-](\d{2})$/);
  if (mmYy) {
    let month = parseInt(mmYy?.[1], 10);
    let year = 2000 + parseInt(mmYy?.[2], 10);
    if (month >= 1 && month <= 12) {
      return `${year}-${String(month)?.padStart(2, '0')}-01`;
    }
  }

  // Handle "Mon YYYY" or "Month YYYY" (e.g. "Jan 2025", "January 2025")
  const monYear = str?.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monYear) {
    const parsed = new Date(`${monYear[1]} 1, ${monYear[2]}`);
    if (!isNaN(parsed?.getTime())) {
      return parsed?.toISOString()?.split('T')?.[0];
    }
  }

  // Handle YYYY only (e.g. "2025") — treat as Jan 1 of that year
  const yearOnly = str?.match(/^(\d{4})$/);
  if (yearOnly) {
    let year = parseInt(yearOnly?.[1], 10);
    if (year >= 1900 && year <= 2100) {
      return `${year}-01-01`;
    }
  }

  // Try direct parse as last resort (handles ISO strings with time component)
  const d = new Date(str);
  if (!isNaN(d?.getTime()) && /\d{4}/?.test(str)) {
    return d?.toISOString()?.split('T')?.[0];
  }

  console.warn('[sanitizeDate] Could not parse date value:', str);
  return null;
};

// Map JS object → DB row
const itemToRow = (item, tenantId) => ({
  tenant_id: tenantId,
  // Preserve existing cargo_item_id — never overwrite it on update
  ...(item?.cargoItemId ? { cargo_item_id: item?.cargoItemId } : {}),
  location: item?.location || null,
  sub_location: item?.subLocation || null,
  tags: item?.tags || [],
  name: item?.name || '',
  unit: item?.unit || 'each',
  size: item?.size || null,
  quantity: item?.quantity ?? item?.totalQty ?? 0,
  total_qty: item?.quantity ?? item?.totalQty ?? 0,
  notes: item?.notes || null,
  // Extended metadata
  description: item?.description || null,
  brand: item?.brand || null,
  year: item?.year ? parseInt(item?.year, 10) : null,
  tasting_notes: item?.tastingNotes || null,
  barcode: item?.barcode || null,
  expiry_date: sanitizeDate(item?.expiryDate),
  default_location_id: item?.defaultLocationId || null,
  // Legacy taxonomy
  l1_id: item?.l1Id || null,
  l2_id: item?.l2Id || null,
  l3_id: item?.l3Id || null,
  l4_id: item?.l4Id || null,
  l1_name: item?.l1Name || null,
  l2_name: item?.l2Name || null,
  l3_name: item?.l3Name || null,
  l4_name: item?.l4Name || null,
  usage_department: item?.usageDepartment || 'INTERIOR',
  stock_locations: item?.stockLocations || [],
  par_level: item?.parLevel ?? null,
  reorder_point: item?.reorderPoint ?? null,
  restock_enabled: item?.restockEnabled || false,
  restock_level: item?.restockLevel ?? null,
  unit_cost: item?.unitCost ?? null,
  currency: item?.currency || 'USD',
  // Strip blob: URLs — they are local-only and cannot be stored in the DB
  image_url: item?.imageUrl && !item?.imageUrl?.startsWith('blob:') ? item?.imageUrl : null,
  supplier: item?.supplier || null,
  condition: item?.condition || null,
  custom_fields: item?.customFields && Object.keys(item?.customFields)?.length > 0 ? item?.customFields : null,
  updated_at: new Date()?.toISOString(),
});

// ============================================
// LOCATION-FIRST QUERIES
// ============================================

/** Get all distinct top-level locations for this tenant */
export const getAllLocations = async () => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId) return [];
    const { data, error } = await supabase
      ?.from('inventory_items')
      ?.select('location')
      ?.eq('tenant_id', tenantId)
      ?.not('location', 'is', null);
    if (error) { console.error('[inventoryStorage] getAllLocations error:', error?.message); return []; }
    const unique = [...new Set((data || [])?.map(r => r?.location)?.filter(Boolean))];
    return unique?.sort();
  } catch (err) {
    console.error('[inventoryStorage] getAllLocations exception:', err?.message);
    return [];
  }
};

/** Get all distinct sub-locations for a given location */
export const getSubLocations = async (location) => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId || !location) return [];
    const { data, error } = await supabase
      ?.from('inventory_items')
      ?.select('sub_location')
      ?.eq('tenant_id', tenantId)
      ?.eq('location', location)
      ?.not('sub_location', 'is', null);
    if (error) { console.error('[inventoryStorage] getSubLocations error:', error?.message); return []; }
    const unique = [...new Set((data || [])?.map(r => r?.sub_location)?.filter(Boolean))];
    return unique?.sort();
  } catch (err) {
    console.error('[inventoryStorage] getSubLocations exception:', err?.message);
    return [];
  }
};

/** Get items by location (and optionally sub_location) */
export const getItemsByLocation = async (location, subLocation = null) => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId) return [];
    let query = supabase
      ?.from('inventory_items')
      ?.select('*')
      ?.eq('tenant_id', tenantId)
      ?.ilike('location', location);
    if (subLocation) query = query?.ilike('sub_location', subLocation);
    query = query?.order('name', { ascending: true });
    const { data, error } = await query;
    if (error) { console.error('[inventoryStorage] getItemsByLocation error:', error?.message); return []; }

    // If primary query returned results, we're done
    if (data && data?.length > 0) {
      return data?.map(rowToItem);
    }

    // Fallback: look for orphaned items (null tenant_id) at this location — these were
    // saved while cargo_active_tenant_id was not yet set in localStorage (timing bug).
    // Re-stamp them with the correct tenant_id so they become permanently visible.
    try {
      let orphanQuery = supabase
        ?.from('inventory_items')
        ?.select('*')
        ?.is('tenant_id', null)
        ?.eq('location', location);
      if (subLocation) orphanQuery = orphanQuery?.eq('sub_location', subLocation);
      const { data: orphans } = await orphanQuery;
      if (orphans && orphans?.length > 0) {
        console.warn(`[inventoryStorage] Found ${orphans?.length} orphaned item(s) at ${location}/${subLocation || ''} — re-stamping with tenant_id ${tenantId}`);
        const ids = orphans?.map(r => r?.id)?.filter(Boolean);
        if (ids?.length > 0) {
          await supabase
            ?.from('inventory_items')
            ?.update({ tenant_id: tenantId })
            ?.in('id', ids);
        }
        return orphans?.map(rowToItem);
      }
    } catch (orphanErr) {
      console.error('[inventoryStorage] orphan fallback error:', orphanErr?.message);
    }

    return [];
  } catch (err) {
    console.error('[inventoryStorage] getItemsByLocation exception:', err?.message);
    return [];
  }
};

/** Get item counts per location */
export const getItemCountByLocation = async () => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId) return {};
    const { data, error } = await supabase
      ?.from('inventory_items')
      ?.select('location')
      ?.eq('tenant_id', tenantId)
      ?.not('location', 'is', null);
    if (error) return {};
    const counts = {};
    (data || [])?.forEach(r => {
      if (r?.location) counts[r.location] = (counts?.[r?.location] || 0) + 1;
    });
    return counts;
  } catch (err) { return {}; }
};

/** Get item counts per sub-location within a location */
export const getItemCountBySubLocation = async (location) => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId || !location) return {};
    const { data, error } = await supabase
      ?.from('inventory_items')
      ?.select('sub_location')
      ?.eq('tenant_id', tenantId)
      ?.eq('location', location);
    if (error) return {};
    const counts = {};
    (data || [])?.forEach(r => {
      const key = r?.sub_location || '(No sub-location)';
      counts[key] = (counts?.[key] || 0) + 1;
    });
    return counts;
  } catch (err) { return {}; }
};

// ============================================
// ITEM CRUD
// ============================================

/**
 * Check whether a folder path (location + optional subLocation) corresponds to
 * a department-level folder (i.e. a root inventory_locations row with no sub_location).
 * Department folders are structural containers — items must NEVER be saved here.
 *
 * Returns true  → the path IS a department folder (block the save)
 * Returns false → the path is a valid sub-folder (allow the save)
 */
export const isDepartmentFolder = async (location, subLocation) => {
  // If there is a non-empty subLocation the item is at least one level deeper than department
  if (subLocation && subLocation?.trim() !== '') return false;
  // No subLocation — check whether the location row is flagged as department root
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId || !location) return false;
    const { data } = await supabase
      ?.from('inventory_locations')
      ?.select('id, is_department_root, sub_location')
      ?.eq('tenant_id', tenantId)
      ?.eq('location', location)
      ?.is('sub_location', null)
      ?.limit(1);
    if (data && data?.length > 0) {
      // Any root-level row (sub_location IS NULL) is a department folder
      return true;
    }
    return false;
  } catch (err) {
    console.error('[inventoryStorage] isDepartmentFolder exception:', err?.message);
    return false;
  }
};

/**
 * Resolve or create a full folder path, guaranteeing the returned path is
 * deeper than the department level.
 *
 * segments: e.g. ['Interior', 'Guest', 'Alcohol', 'Wine']
 *
 * - Creates any missing intermediate folders
 * - Returns the deepest folder's path segments
 * - Throws if segments.length < 2 (would land in a department folder)
 */
export const resolveOrCreateFolderPath = async (segments) => {
  if (!segments || segments?.length < 2) {
    throw new Error('Subfolder required — items cannot be saved directly in department folders');
  }
  // Create each level in sequence (createFolder is idempotent)
  for (let i = 0; i < segments?.length; i++) {
    const parentSegments = segments?.slice(0, i);
    const name = segments?.[i];
    try {
      await createFolder(parentSegments, name);
    } catch (_) {
      // Non-fatal — folder may already exist
    }
  }
  return segments;
};

export const getAllItems = async () => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId) return [];
    const { data, error } = await supabase
      ?.from('inventory_items')
      ?.select('*')
      ?.eq('tenant_id', tenantId)
      ?.order('created_at', { ascending: false });
    if (error) { console.error('[inventoryStorage] getAllItems error:', error?.message); return []; }
    return (data || [])?.map(rowToItem);
  } catch (err) {
    console.error('[inventoryStorage] getAllItems exception:', err?.message);
    return [];
  }
};

export const getItemById = async (itemId) => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId) return null;
    const { data, error } = await supabase
      ?.from('inventory_items')
      ?.select('*')
      ?.eq('id', itemId)
      ?.eq('tenant_id', tenantId)
      ?.maybeSingle();
    if (error) { console.error('[inventoryStorage] getItemById error:', error?.message); return null; }
    return rowToItem(data);
  } catch (err) {
    console.error('[inventoryStorage] getItemById exception:', err?.message);
    return null;
  }
};

export const saveItem = async (itemData) => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId) return false;

    // ── Department-folder guard ───────────────────────────────────────────────
    // Items must never be saved directly into a department-level folder.
    // A department folder is a root inventory_locations row (sub_location IS NULL).
    let location = itemData?.location || '';
    const subLocation = itemData?.subLocation || '';
    if (location) {
      const isDept = await isDepartmentFolder(location, subLocation);
      if (isDept) {
        throw new Error(
          `Items cannot be saved in department folders. "${location}" is a top-level department folder. Please select a subfolder.`
        );
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const currentUser = getCurrentUser();
    const { data: { session } } = await supabase?.auth?.getSession();
    const supabaseUserId = session?.user?.id || null;
    const isUpdate = !!itemData?.id;
    const row = itemToRow(itemData, tenantId);

    // Remove client-side cargo_item_id generation — the DB trigger assigns it atomically on insert.
    // This prevents duplicate key errors caused by concurrent read-then-write race conditions.

    // On update: preserve the existing cargo_item_id (never overwrite)
    if (isUpdate && itemData?.cargoItemId) {
      row.cargo_item_id = itemData?.cargoItemId;
    } else if (isUpdate) {
      // Don't send cargo_item_id in update if we don't have one (avoid null overwrite)
      delete row?.cargo_item_id;
    }

    let savedItem = null;
    if (isUpdate) {
      row.updated_by = supabaseUserId;
      const { data, error } = await supabase
        ?.from('inventory_items')
        ?.update(row)
        ?.eq('id', itemData?.id)
        ?.eq('tenant_id', tenantId)
        ?.select()
        ?.maybeSingle();
      if (error) { console.error('[inventoryStorage] saveItem update error:', error?.message); return false; }
      if (!data) { console.error('[inventoryStorage] saveItem update error: no row matched id', itemData?.id); return false; }
      savedItem = rowToItem(data);
    } else {
      row.created_by = supabaseUserId;
      const { data, error } = await supabase
        ?.from('inventory_items')
        ?.insert(row)
        ?.select()
        ?.single();
      if (error) { console.error('[inventoryStorage] saveItem insert error:', error?.message); return false; }
      savedItem = rowToItem(data);
    }
    // Best-effort: write icon/color separately (columns may not exist on all DB instances)
    if (savedItem?.id && (itemData?.icon || itemData?.color)) {
      try {
        await supabase?.from('inventory_items')
          ?.update({ icon: itemData?.icon || null, color: itemData?.color || null })
          ?.eq('id', savedItem.id)
          ?.eq('tenant_id', tenantId);
      } catch (_) {}
    }
    // Log activity
    try {
      logActivity({
        actorUserId: supabaseUserId,
        actorName: currentUser?.name || 'Unknown User',
        actorDepartment: currentUser?.department || 'UNKNOWN',
        actorRoleTier: currentUser?.tier || 'CREW',
        departmentScope: savedItem?.usageDepartment || 'INTERIOR',
        module: 'inventory',
        action: isUpdate ? InventoryActions?.ITEM_UPDATED : InventoryActions?.ITEM_CREATED,
        entityType: 'inventoryItem',
        entityId: savedItem?.id,
        summary: `${currentUser?.name || 'Unknown'} ${isUpdate ? 'updated' : 'added'} "${savedItem?.name}"`,
        meta: { itemName: savedItem?.name, location: savedItem?.location, subLocation: savedItem?.subLocation }
      });
    } catch (_) {}
    return savedItem || true;
  } catch (err) {
    console.error('[inventoryStorage] saveItem exception:', err?.message);
    return false;
  }
};

export const deleteItem = async (itemId) => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId) return false;
    const { error } = await supabase
      ?.from('inventory_items')
      ?.delete()
      ?.eq('id', itemId)
      ?.eq('tenant_id', tenantId);
    if (error) { console.error('[inventoryStorage] deleteItem error:', error?.message); return false; }
    return true;
  } catch (err) {
    console.error('[inventoryStorage] deleteItem exception:', err?.message);
    return false;
  }
};

export const bulkDeleteItems = async (location, subLocation = null) => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId) return 0;
    let query = supabase?.from('inventory_items')?.delete()?.eq('tenant_id', tenantId)?.eq('location', location);
    if (subLocation) query = query?.eq('sub_location', subLocation);
    const { error, count } = await query;
    if (error) { console.error('[inventoryStorage] bulkDeleteItems error:', error?.message); return 0; }
    return count || 0;
  } catch (err) {
    console.error('[inventoryStorage] bulkDeleteItems exception:', err?.message);
    return 0;
  }
};

export const bulkDeleteItemsByIds = async (itemIds) => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId || !itemIds?.length) return false;
    const { error } = await supabase
      ?.from('inventory_items')
      ?.delete()
      ?.in('id', itemIds)
      ?.eq('tenant_id', tenantId);
    if (error) { console.error('[inventoryStorage] bulkDeleteItemsByIds error:', error?.message); return false; }
    return true;
  } catch (err) {
    console.error('[inventoryStorage] bulkDeleteItemsByIds exception:', err?.message);
    return false;
  }
};

/** Move multiple items to a new location/sub_location */
export const bulkMoveItemsByIds = async (itemIds, newLocation, newSubLocation = null) => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId || !itemIds?.length) return false;
    const updatePayload = {
      location: newLocation || null,
      sub_location: newSubLocation || null,
      updated_at: new Date()?.toISOString(),
    };
    const { error } = await supabase
      ?.from('inventory_items')
      ?.update(updatePayload)
      ?.in('id', itemIds)
      ?.eq('tenant_id', tenantId);
    if (error) { console.error('[inventoryStorage] bulkMoveItemsByIds error:', error?.message); return false; }
    return true;
  } catch (err) {
    console.error('[inventoryStorage] bulkMoveItemsByIds exception:', err?.message);
    return false;
  }
};

/** Legacy taxonomy query - kept for backward compat */
export const getItemsByTaxonomy = async (l1Id, l2Id = null, l3Id = null, l4Id = null) => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId) return [];
    let query = supabase?.from('inventory_items')?.select('*')?.eq('tenant_id', tenantId)?.eq('l1_id', l1Id);
    if (l2Id !== null) query = query?.eq('l2_id', l2Id);
    if (l3Id !== null) query = query?.eq('l3_id', l3Id);
    if (l4Id !== null) query = query?.eq('l4_id', l4Id);
    query = query?.order('name', { ascending: true });
    const { data, error } = await query;
    if (error) { console.error('[inventoryStorage] getItemsByTaxonomy error:', error?.message); return []; }
    return (data || [])?.map(rowToItem);
  } catch (err) {
    console.error('[inventoryStorage] getItemsByTaxonomy exception:', err?.message);
    return [];
  }
};

/** Quick quantity adjustment */
export const adjustItemQuantity = async (itemId, delta) => {
  try {
    const item = await getItemById(itemId);
    if (!item) return false;
    const newQty = Math.max(0, (item?.quantity || 0) + delta);
    return await saveItem({ ...item, quantity: newQty, totalQty: newQty });
  } catch (err) {
    console.error('[inventoryStorage] adjustItemQuantity exception:', err?.message);
    return false;
  }
};

/** Update stock locations for an item and recalculate total quantity */
export const updateItemStockLocations = async (itemId, updatedLocations) => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId || !itemId) return false;
    const totalQty = (updatedLocations || [])?.reduce((sum, loc) => sum + (loc?.qty || 0), 0);
    const { error } = await supabase
      ?.from('inventory_items')
      ?.update({
        stock_locations: updatedLocations || [],
        quantity: totalQty,
        total_qty: totalQty,
        updated_at: new Date()?.toISOString(),
      })
      ?.eq('id', itemId)
      ?.eq('tenant_id', tenantId);
    if (error) {
      console.error('[inventoryStorage] updateItemStockLocations error:', error?.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[inventoryStorage] updateItemStockLocations exception:', err?.message);
    return false;
  }
};

export const updateItemAppearance = async (itemId, icon, color) => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId || !itemId) return false;
    const { error } = await supabase
      ?.from('inventory_items')
      ?.update({ icon: icon || null, color: color || null, updated_at: new Date()?.toISOString() })
      ?.eq('id', itemId)
      ?.eq('tenant_id', tenantId);
    if (error) { console.error('[inventoryStorage] updateItemAppearance error:', error?.message); return false; }
    return true;
  } catch (err) {
    console.error('[inventoryStorage] updateItemAppearance exception:', err?.message);
    return false;
  }
};

export const updatePartialBottle = async (itemId, fraction) => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId || !itemId) return false;
    const value = fraction == null ? null : Math.max(0, Math.min(1, parseFloat(fraction)));
    const { error } = await supabase
      ?.from('inventory_items')
      ?.update({ partial_bottle: value, updated_at: new Date()?.toISOString() })
      ?.eq('id', itemId)
      ?.eq('tenant_id', tenantId);
    if (error) { console.error('[inventoryStorage] updatePartialBottle error:', error?.message); return false; }
    return true;
  } catch (err) {
    console.error('[inventoryStorage] updatePartialBottle exception:', err?.message);
    return false;
  }
};

function getInventoryHealthStats(...args) {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: getInventoryHealthStats is not implemented yet.', args);
  return null;
}

export { getInventoryHealthStats };

// ============================================
// FOLDER TREE — Supabase-backed (inventory_locations)
// ============================================

/**
 * Row shape in inventory_locations:
 *   location     = root folder name (e.g. 'Interior')
 *   sub_location = null for root, or path joined with ' > ' (e.g. 'Pantries > Cold Storage')
 */

/**
 * Fetch the full folder tree for the current tenant from Supabase.
 * Returns the same shape as the old localStorage tree:
 *   { [pathKey]: { subFolders: string[], renamedMap: {} } }
 * where pathKey = segments joined by '|||'
 * Root folders come ONLY from inventory_locations rows where sub_location IS NULL.
 */
export const getFolderTree = async () => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId) return {};

    // Guard: ensure a valid session exists before querying (prevents TypeError: Load failed)
    let { data: sessionData } = await supabase?.auth?.getSession();
    if (!sessionData?.session) {
      // Wait briefly and retry once — session may still be initialising
      await new Promise(resolve => setTimeout(resolve, 800));
      const retry = await supabase?.auth?.getSession();
      sessionData = retry?.data;
      if (!sessionData?.session) {
        console.warn('[inventoryStorage] getFolderTree: no active session, skipping query');
        return {};
      }
    }

    // Retry logic: up to 3 attempts with exponential backoff for transient network errors
    let data = null;
    let error = null;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await supabase
          ?.from('inventory_locations')
          ?.select('location, sub_location, is_department_root, department, visibility, icon, color')
          ?.eq('tenant_id', tenantId)
          ?.eq('is_archived', false)
          ?.order('sort_order', { ascending: true });
        data = result?.data;
        error = result?.error;
        if (!error) break; // success — exit retry loop
        // Supabase-level error (not a network error) — no point retrying
        break;
      } catch (fetchErr) {
        // TypeError: Load failed or similar network-level error
        if (attempt < maxAttempts) {
          const delay = attempt * 1000; // 1s, 2s
          console.warn(`[inventoryStorage] getFolderTree fetch attempt ${attempt} failed (${fetchErr?.message}), retrying in ${delay}ms…`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error('[inventoryStorage] getFolderTree fetch failed after all retries:', fetchErr?.message);
          return {};
        }
      }
    }

    if (error) { console.error('[inventoryStorage] getFolderTree error:', error?.message); return {}; }
    // Reconstruct tree from flat rows
    const tree = {};
    const ensureKey = (key) => {
      if (!tree?.[key]) tree[key] = { subFolders: [], renamedMap: {}, folderMeta: {} };
    };
    (data || [])?.forEach(row => {
      const loc = row?.location;
      const sub = row?.sub_location;
      if (!loc) return;
      if (!sub) {
        // Root folder
        const rootKey = '';
        ensureKey(rootKey);
        if (!tree?.[rootKey]?.subFolders?.includes(loc)) {
          tree?.[rootKey]?.subFolders?.push(loc);
        }
        tree[rootKey].folderMeta[loc] = { icon: row?.icon || null, color: row?.color || null };
      } else {
        // Sub-folder path: 'Pantries' or 'Pantries > Cold Storage'
        const subSegments = sub?.split(' > ');
        // Parent path = [loc, ...subSegments.slice(0, -1)]
        const parentSegments = [loc, ...subSegments?.slice(0, -1)];
        const parentKey = parentSegments?.join('|||');
        const childName = subSegments?.[subSegments?.length - 1];
        ensureKey(parentKey);
        if (!tree?.[parentKey]?.subFolders?.includes(childName)) {
          tree?.[parentKey]?.subFolders?.push(childName);
        }
        tree[parentKey].folderMeta[childName] = { icon: row?.icon || null, color: row?.color || null };
      }
    });
    return tree;
  } catch (err) {
    console.error('[inventoryStorage] getFolderTree exception:', err?.message);
    return {};
  }
};

/**
 * Ensure one root inventory_locations row per department.
 * Takes array of department objects { id, name } from get_tenant_departments RPC.
 * Upserts rows with is_department_root=true, sub_location=null.
 * Does NOT delete existing department folders.
 * Returns array of department folder names.
 */
export const ensureDepartmentFolders = async (departments) => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId || !departments?.length) return [];
    const { data: { session } } = await supabase?.auth?.getSession();
    const userId = session?.user?.id || null;

    // Fetch existing root rows
    const { data: existing, error: fetchError } = await supabase
      ?.from('inventory_locations')
      ?.select('id, location, is_department_root')
      ?.eq('tenant_id', tenantId)
      ?.is('sub_location', null)
      ?.eq('is_archived', false);

    if (fetchError) {
      console.error('[inventoryStorage] ensureDepartmentFolders fetch error:', fetchError?.message);
    }

    const existingRootNames = new Set((existing || [])?.map(r => r?.location));

    // Insert missing department root folders
    const toInsert = departments
      ?.filter(d => d?.name && !existingRootNames?.has(d?.name))
      ?.map((d, idx) => ({
        tenant_id: tenantId,
        location: d?.name,
        sub_location: null,
        department: d?.name,
        is_department_root: true,
        visibility: 'everyone',
        is_archived: false,
        sort_order: (existing?.length || 0) + idx,
        created_by: userId,
      }));

    if (toInsert?.length > 0) {
      console.log('[inventoryStorage] ensureDepartmentFolders inserting', toInsert?.length, 'rows. Sample:', JSON.stringify(toInsert?.[0]));
      const { data: insertedData, error } = await supabase
        ?.from('inventory_locations')
        ?.insert(toInsert)
        ?.select('id, location');
      if (error) {
        console.error('[inventoryStorage] ensureDepartmentFolders insert FAILED:', error?.message, '| code:', error?.code, '| details:', error?.details, '| hint:', error?.hint, '| payload sample:', JSON.stringify(toInsert?.[0]));
      } else {
        console.log('[inventoryStorage] ensureDepartmentFolders insert SUCCESS:', insertedData?.length, 'rows inserted');
      }
    } else {
      console.log('[inventoryStorage] ensureDepartmentFolders: all', departments?.length, 'departments already exist in inventory_locations');
    }

    // Also mark any existing root rows that match department names as is_department_root=true
    const deptNames = departments?.map(d => d?.name);
    const existingNonRoot = (existing || [])?.filter(
      r => deptNames?.includes(r?.location) && !r?.is_department_root
    );
    for (const row of existingNonRoot) {
      await supabase
        ?.from('inventory_locations')
        ?.update({ is_department_root: true, department: row?.location })
        ?.eq('id', row?.id);
    }

    return departments?.map(d => d?.name);
  } catch (err) {
    console.error('[inventoryStorage] ensureDepartmentFolders exception:', err?.message);
    return departments?.map(d => d?.name) || [];
  }
};

/**
 * Update visibility for a folder and cascade to all its sub-folders.
 * parentSegments = path to parent of the folder
 * folderName = name of the folder
 * visibility = 'everyone' | 'chief_hod_command' | 'chief_command' | 'command_only'
 */
export const updateFolderVisibility = async (parentSegments, folderName, visibility) => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId) return false;

    if (parentSegments?.length === 0) {
      // Root folder: update all rows where location = folderName
      const { error } = await supabase
        ?.from('inventory_locations')
        ?.update({ visibility })
        ?.eq('tenant_id', tenantId)
        ?.eq('location', folderName);
      if (error) { console.error('[inventoryStorage] updateFolderVisibility root error:', error?.message); return false; }
    } else {
      let location = parentSegments?.[0];
      const parentSubPath = parentSegments?.slice(1)?.join(' > ');
      const subPath = parentSubPath ? `${parentSubPath} > ${folderName}` : folderName;
      // Update exact row
      await supabase
        ?.from('inventory_locations')
        ?.update({ visibility })
        ?.eq('tenant_id', tenantId)
        ?.eq('location', location)
        ?.eq('sub_location', subPath);
      // Update all descendants
      const { data: descendants } = await supabase
        ?.from('inventory_locations')
        ?.select('id')
        ?.eq('tenant_id', tenantId)
        ?.eq('location', location)
        ?.like('sub_location', `${subPath} > %`);
      if (descendants?.length > 0) {
        await supabase
          ?.from('inventory_locations')
          ?.update({ visibility })
          ?.in('id', descendants?.map(r => r?.id));
      }
    }
    return true;
  } catch (err) {
    console.error('[inventoryStorage] updateFolderVisibility exception:', err?.message);
    return false;
  }
};

/**
 * Archive a folder (sets is_archived=true) — hides from normal view but keeps data.
 * Cascades to all sub-folders.
 */
export const archiveFolder = async (parentSegments, folderName) => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId) return false;

    if (parentSegments?.length === 0) {
      const { error } = await supabase
        ?.from('inventory_locations')
        ?.update({ is_archived: true })
        ?.eq('tenant_id', tenantId)
        ?.eq('location', folderName);
      if (error) { console.error('[inventoryStorage] archiveFolder root error:', error?.message); return false; }
    } else {
      let location = parentSegments?.[0];
      const parentSubPath = parentSegments?.slice(1)?.join(' > ');
      const subPath = parentSubPath ? `${parentSubPath} > ${folderName}` : folderName;
      await supabase
        ?.from('inventory_locations')
        ?.update({ is_archived: true })
        ?.eq('tenant_id', tenantId)
        ?.eq('location', location)
        ?.eq('sub_location', subPath);
      const { data: descendants } = await supabase
        ?.from('inventory_locations')
        ?.select('id')
        ?.eq('tenant_id', tenantId)
        ?.eq('location', location)
        ?.like('sub_location', `${subPath} > %`);
      if (descendants?.length > 0) {
        await supabase
          ?.from('inventory_locations')
          ?.update({ is_archived: true })
          ?.in('id', descendants?.map(r => r?.id));
      }
    }
    return true;
  } catch (err) {
    console.error('[inventoryStorage] archiveFolder exception:', err?.message);
    return false;
  }
};

/**
 * Create a folder in inventory_locations.
 * parentSegments = [] for root, ['Interior'] for sub-folder of Interior, etc.
 * name = new folder name
 */
export const createFolder = async (parentSegments, name, icon = null, color = null) => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId) return false;
    const { data: { session } } = await supabase?.auth?.getSession();
    const userId = session?.user?.id || null;
    let location, sub_location;
    if (parentSegments?.length === 0) {
      // Root folder
      location = name;
      sub_location = null;
    } else {
      // Sub-folder
      location = parentSegments?.[0];
      const subParts = [...parentSegments?.slice(1), name];
      sub_location = subParts?.join(' > ');
    }
    // Check if already exists
    const { data: existing } = await supabase
      ?.from('inventory_locations')
      ?.select('id')
      ?.eq('tenant_id', tenantId)
      ?.eq('location', location)
      ?.is(sub_location === null ? 'sub_location' : 'id', sub_location === null ? null : undefined)
      ?.limit(1);
    // Use upsert-style: only insert if not present
    let checkQuery = supabase
      ?.from('inventory_locations')
      ?.select('id')
      ?.eq('tenant_id', tenantId)
      ?.eq('location', location);
    if (sub_location === null) {
      checkQuery = checkQuery?.is('sub_location', null);
    } else {
      checkQuery = checkQuery?.eq('sub_location', sub_location);
    }
    const { data: existingRows } = await checkQuery?.limit(1);
    if (existingRows?.length > 0) return true; // already exists
    const { error } = await supabase
      ?.from('inventory_locations')
      ?.insert({
        tenant_id: tenantId,
        location,
        sub_location: sub_location || null,
        created_by: userId,
        is_archived: false,
        sort_order: 0,
        icon: icon || null,
        color: color || null,
      });
    if (error) { console.error('[inventoryStorage] createFolder error:', error?.message); return false; }
    return true;
  } catch (err) {
    console.error('[inventoryStorage] createFolder exception:', err?.message);
    return false;
  }
};

/**
 * Update icon and color on an existing folder row in inventory_locations.
 */
export const updateFolderAppearance = async (pathSegments, name, icon, color) => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId) return false;
    let location, sub_location;
    if (pathSegments?.length === 0) {
      location = name;
      sub_location = null;
    } else {
      location = pathSegments?.[0];
      const subParts = [...pathSegments?.slice(1), name];
      sub_location = subParts?.join(' > ');
    }
    let query = supabase
      ?.from('inventory_locations')
      ?.update({ icon: icon || null, color: color || null })
      ?.eq('tenant_id', tenantId)
      ?.eq('location', location);
    if (sub_location === null) {
      query = query?.is('sub_location', null);
    } else {
      query = query?.eq('sub_location', sub_location);
    }
    const { error } = await query;
    if (error) { console.error('[inventoryStorage] updateFolderAppearance error:', error?.message); return false; }
    return true;
  } catch (err) {
    console.error('[inventoryStorage] updateFolderAppearance exception:', err?.message);
    return false;
  }
};

/**
 * Rename a folder in inventory_locations.
 * parentSegments = path to the parent of the folder being renamed
 * oldName = current folder name
 * newName = new folder name
 */
export const renameFolderInDB = async (parentSegments, oldName, newName) => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId) return false;
    if (parentSegments?.length === 0) {
      // Renaming a root folder: update all rows where location = oldName
      const { error } = await supabase
        ?.from('inventory_locations')
        ?.update({ location: newName })
        ?.eq('tenant_id', tenantId)
        ?.eq('location', oldName);
      if (error) { console.error('[inventoryStorage] renameFolderInDB root error:', error?.message); return false; }
      // Also update inventory_items
      await supabase
        ?.from('inventory_items')
        ?.update({ location: newName })
        ?.eq('tenant_id', tenantId)
        ?.eq('location', oldName);
    } else {
      // Renaming a sub-folder
      let location = parentSegments?.[0];
      const parentSubPath = parentSegments?.slice(1)?.join(' > ');
      const oldSubPath = parentSubPath ? `${parentSubPath} > ${oldName}` : oldName;
      const newSubPath = parentSubPath ? `${parentSubPath} > ${newName}` : newName;
      // Update exact match
      const { error } = await supabase
        ?.from('inventory_locations')
        ?.update({ sub_location: newSubPath })
        ?.eq('tenant_id', tenantId)
        ?.eq('location', location)
        ?.eq('sub_location', oldSubPath);
      if (error) { console.error('[inventoryStorage] renameFolderInDB sub error:', error?.message); return false; }
      // Update all descendants: sub_location starts with oldSubPath + ' > '
      const { data: descendants } = await supabase
        ?.from('inventory_locations')
        ?.select('id, sub_location')
        ?.eq('tenant_id', tenantId)
        ?.eq('location', location)
        ?.like('sub_location', `${oldSubPath} > %`);
      for (const row of (descendants || [])) {
        const updated = row?.sub_location?.replace(oldSubPath + ' > ', newSubPath + ' > ');
        await supabase?.from('inventory_locations')?.update({ sub_location: updated })?.eq('id', row?.id);
      }
      // Also update inventory_items sub_location
      const { data: itemDescendants } = await supabase
        ?.from('inventory_items')
        ?.select('id, sub_location')
        ?.eq('tenant_id', tenantId)
        ?.eq('location', location)
        ?.or(`sub_location.eq.${oldSubPath},sub_location.like.${oldSubPath} > %`);
      for (const row of (itemDescendants || [])) {
        const updated = row?.sub_location?.startsWith(oldSubPath + ' > ')
          ? row?.sub_location?.replace(oldSubPath + ' > ', newSubPath + ' > ')
          : newSubPath;
        await supabase?.from('inventory_items')?.update({ sub_location: updated })?.eq('id', row?.id);
      }
    }
    return true;
  } catch (err) {
    console.error('[inventoryStorage] renameFolderInDB exception:', err?.message);
    return false;
  }
};

/**
 * Delete a folder and all its descendants from inventory_locations.
 * parentSegments = path to the parent of the folder being deleted
 * name = folder name to delete
 */
export const deleteFolderFromDB = async (parentSegments, name) => {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 800;

  const attemptDelete = async () => {
    const tenantId = getActiveTenantId();
    if (!tenantId) return false;
    if (parentSegments?.length === 0) {
      // Deleting a root folder — fetch all rows where location = name
      const { error } = await supabase
        ?.from('inventory_locations')
        ?.delete()
        ?.eq('tenant_id', tenantId)
        ?.eq('location', name);
      if (error) { console.error('[inventoryStorage] deleteFolderFromDB root error:', error?.message); return false; }
    } else {
      let location = parentSegments?.[0];
      const parentSubPath = parentSegments?.slice(1)?.join(' > ');
      const subPath = parentSubPath ? `${parentSubPath} > ${name}` : name;
      console.log('[inventoryStorage] deleteFolderFromDB — location:', location, '| subPath to delete:', subPath);
      // Fetch all rows for this location so we can filter descendants
      const { data: toDelete, error: fetchError } = await supabase
        ?.from('inventory_locations')
        ?.select('id, sub_location')
        ?.eq('tenant_id', tenantId)
        ?.eq('location', location);
      if (fetchError) { console.error('[inventoryStorage] deleteFolderFromDB fetch error:', fetchError?.message); return false; }
      console.log('[inventoryStorage] deleteFolderFromDB — rows fetched:', (toDelete || [])?.length, '| sample sub_locations:', (toDelete || [])?.slice(0, 5)?.map(r => r?.sub_location));
      const idsToDelete = (toDelete || [])
        ?.filter(r => r?.sub_location === subPath || r?.sub_location?.startsWith(subPath + ' > '))
        ?.map(r => r?.id);
      console.log('[inventoryStorage] deleteFolderFromDB — ids to delete:', idsToDelete?.length);
      if (idsToDelete?.length > 0) {
        const { error: deleteError } = await supabase
          ?.from('inventory_locations')
          ?.delete()
          ?.in('id', idsToDelete);
        if (deleteError) { console.error('[inventoryStorage] deleteFolderFromDB delete error:', deleteError?.message); return false; }
      } else {
        // No rows matched — the folder may only exist as a virtual node (no DB row of its own).
        // Try a direct delete by matching sub_location exactly (covers the case where the folder
        // itself has no children and its own row uses a different path format).
        const { error: directError } = await supabase
          ?.from('inventory_locations')
          ?.delete()
          ?.eq('tenant_id', tenantId)
          ?.eq('location', location)
          ?.eq('sub_location', subPath);
        if (directError) { console.error('[inventoryStorage] deleteFolderFromDB direct error:', directError?.message); return false; }
        console.log('[inventoryStorage] deleteFolderFromDB — direct delete attempted for sub_location:', subPath);
      }
    }
    return true;
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await attemptDelete();
      if (result) return true;
      // Non-network error (RLS, constraint) — don't retry
      return false;
    } catch (err) {
      const isNetworkError = err?.message?.includes('Load failed') || err?.message?.includes('Failed to fetch') || err?.name === 'TypeError';
      console.error(`[inventoryStorage] deleteFolderFromDB attempt ${attempt}/${MAX_RETRIES} exception:`, err?.message);
      if (!isNetworkError || attempt === MAX_RETRIES) {
        console.error('[inventoryStorage] deleteFolderFromDB exception:', err?.message);
        return false;
      }
      // Wait before retrying on network error
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
  }
  return false;
};

/**
 * Move a folder into another folder (iOS-style drag-into-folder).
 * draggedSegments = full path segments of the folder being dragged (e.g. ['Interior', 'Pantry'])
 * targetSegments = full path segments of the destination folder (e.g. ['Galley'])
 * draggedName = the name of the folder being moved
 */
export const moveFolderInDB = async (draggedSegments, targetSegments, draggedName) => {
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId) return false;

    // Build old and new paths
    const oldParentSegments = draggedSegments;
    const newParentSegments = [...targetSegments, draggedName];

    // Old sub_location path for the dragged folder itself
    const oldLocation = oldParentSegments?.[0];
    const oldSubPath = oldParentSegments?.slice(1)?.join(' > ');
    const oldFullPath = oldSubPath ? `${oldSubPath} > ${draggedName}` : draggedName;

    // New location/sub_location for the dragged folder
    const newLocation = targetSegments?.[0];
    const newParentSubPath = targetSegments?.slice(1)?.join(' > ');
    const newFullPath = newParentSubPath ? `${newParentSubPath} > ${draggedName}` : draggedName;

    // 1. Fetch all inventory_locations rows that are the dragged folder itself or its descendants
    let allRows = [];
    if (oldParentSegments?.length === 0) {
      // Moving a root folder — fetch all rows where location = draggedName
      const { data } = await supabase
        ?.from('inventory_locations')
        ?.select('id, location, sub_location')
        ?.eq('tenant_id', tenantId)
        ?.eq('location', draggedName);
      allRows = data || [];
    } else {
      // Moving a sub-folder — fetch the exact row + all descendants
      const { data: exactRow } = await supabase
        ?.from('inventory_locations')
        ?.select('id, location, sub_location')
        ?.eq('tenant_id', tenantId)
        ?.eq('location', oldLocation)
        ?.eq('sub_location', oldFullPath);
      const { data: descendants } = await supabase
        ?.from('inventory_locations')
        ?.select('id, location, sub_location')
        ?.eq('tenant_id', tenantId)
        ?.eq('location', oldLocation)
        ?.like('sub_location', `${oldFullPath} > %`);
      // Also items directly in the folder (sub_location = oldFullPath)
      allRows = [...(exactRow || []), ...(descendants || [])];
    }

    // 2. Update each inventory_locations row
    for (const row of allRows) {
      let updatedLocation;
      let updatedSubLocation;

      if (oldParentSegments?.length === 0) {
        // Was a root folder
        updatedLocation = newLocation;
        if (row?.sub_location) {
          updatedSubLocation = newFullPath + ' > ' + row?.sub_location;
        } else {
          // This is the folder row itself
          updatedSubLocation = newFullPath || null;
        }
      } else {
        // Was a sub-folder
        updatedLocation = newLocation;
        if (row?.sub_location === oldFullPath) {
          // The dragged folder itself
          updatedSubLocation = newFullPath;
        } else {
          // A descendant: replace the old prefix with the new prefix
          const suffix = row?.sub_location?.slice(oldFullPath?.length);
          updatedSubLocation = newFullPath + suffix;
        }
      }

      await supabase
        ?.from('inventory_locations')
        ?.update({ location: updatedLocation, sub_location: updatedSubLocation })
        ?.eq('id', row?.id);
    }

    // 3. Update inventory_items that were in the dragged folder or its descendants
    let itemRows = [];
    if (oldParentSegments?.length === 0) {
      const { data } = await supabase
        ?.from('inventory_items')
        ?.select('id, location, sub_location')
        ?.eq('tenant_id', tenantId)
        ?.eq('location', draggedName);
      itemRows = data || [];
    } else {
      const { data: exactItems } = await supabase
        ?.from('inventory_items')
        ?.select('id, location, sub_location')
        ?.eq('tenant_id', tenantId)
        ?.eq('location', oldLocation)
        ?.eq('sub_location', oldFullPath);
      const { data: descItems } = await supabase
        ?.from('inventory_items')
        ?.select('id, location, sub_location')
        ?.eq('tenant_id', tenantId)
        ?.eq('location', oldLocation)
        ?.like('sub_location', `${oldFullPath} > %`);
      // Also items directly in the folder (sub_location = oldFullPath)
      itemRows = [...(exactItems || []), ...(descItems || [])];
    }

    for (const item of itemRows) {
      let updatedLocation = newLocation;
      let updatedSubLocation;

      if (oldParentSegments?.length === 0) {
        // Was root folder
        if (!item?.sub_location) {
          updatedSubLocation = null; // item was directly in root folder, now in target
        } else {
          updatedSubLocation = newFullPath + ' > ' + item?.sub_location;
        }
      } else {
        if (item?.sub_location === oldFullPath) {
          updatedSubLocation = newFullPath;
        } else if (item?.sub_location?.startsWith(oldFullPath + ' > ')) {
          const suffix = item?.sub_location?.slice(oldFullPath?.length);
          updatedSubLocation = newFullPath + suffix;
        } else {
          updatedSubLocation = item?.sub_location;
        }
      }

      await supabase
        ?.from('inventory_items')
        ?.update({ location: updatedLocation, sub_location: updatedSubLocation })
        ?.eq('id', item?.id);
    }

    return true;
  } catch (err) {
    console.error('[inventoryStorage] moveFolderInDB exception:', err?.message);
    return false;
  }
};

/**
 * One-time migration: reads cargo_folder_tree_v2 from localStorage,
 * converts every path entry into rows in inventory_locations,
 * then removes the localStorage key and marks migration complete.
 */
export const migrateLocalStorageFolderTree = async () => {
  const MIGRATION_KEY = 'cargo_folder_tree_migrated_v1';
  const TREE_KEY = 'cargo_folder_tree_v2';
  const DEFAULT_FOLDERS = [
    { location: 'Galley', sub_location: null },
    { location: 'Galley', sub_location: 'Dry Store' },
    { location: 'Galley', sub_location: 'Fridge 1' },
    { location: 'Galley', sub_location: 'Fridge 2' },
    { location: 'Galley', sub_location: 'Freezer' },
    { location: 'Interior', sub_location: null },
    { location: 'Interior', sub_location: 'Pantry' },
    { location: 'Deck', sub_location: null },
    { location: 'Medical', sub_location: null },
  ];
  try {
    const tenantId = getActiveTenantId();
    if (!tenantId) return; // wait until tenant is available

    // Check if migration was previously marked done
    const alreadyMigrated = localStorage.getItem(MIGRATION_KEY);
    if (alreadyMigrated) {
      // Guard #2: only skip if table has a FULL seed (>= DEFAULT_FOLDERS.length rows)
      // Checking > 0 was wrong — a partial seed (e.g. 1 row) would permanently block re-seeding
      const { data: existingRows, error: checkError } = await supabase
        ?.from('inventory_locations')
        ?.select('id')
        ?.eq('tenant_id', tenantId)
        ?.eq('is_archived', false);
      const rowCount = (!checkError && existingRows) ? existingRows?.length : 0;
      if (rowCount >= DEFAULT_FOLDERS?.length) return; // full seed present, nothing to do
      // Partial or empty — reset flag and fall through to re-seed
      console.log(`[inventoryStorage] Migration flag set but only ${rowCount} rows found (need ${DEFAULT_FOLDERS?.length}) — resetting and re-seeding.`);
      localStorage.removeItem(MIGRATION_KEY);
    }

    const raw = localStorage.getItem(TREE_KEY);
    const { data: { session } } = await supabase?.auth?.getSession();
    const userId = session?.user?.id || null;

    if (!raw) {
      // localStorage tree is gone — seed the default folder structure using plain insert + manual dedup
      console.log('[inventoryStorage] No localStorage tree found — seeding default folder structure.');

      // Fetch all existing rows for this tenant to deduplicate manually
      const { data: existingCheck } = await supabase
        ?.from('inventory_locations')
        ?.select('location, sub_location')
        ?.eq('tenant_id', tenantId)
        ?.eq('is_archived', false);
      const existingCheckSet = new Set(
        (existingCheck || [])?.map(r => `${r?.location}|||${r?.sub_location ?? ''}`)
      );

      const toInsert = DEFAULT_FOLDERS
        ?.filter(f => {
          const key = `${f?.location}|||${f?.sub_location ?? ''}`;
          return !existingCheckSet?.has(key);
        })
        ?.map((f, idx) => ({
          tenant_id: tenantId,
          location: f?.location,
          sub_location: f?.sub_location,
          created_by: userId,
          is_archived: false,
          sort_order: (existingCheck?.length || 0) + idx,
        }));

      if (toInsert?.length > 0) {
        // Deduplicate by location + sub_location
        const seen = new Set();
        const unique = toInsert?.filter(r => {
          const key = `${r?.location}|||${r?.sub_location ?? ''}`;
          if (seen?.has(key)) return false;
          seen?.add(key);
          return true;
        });
        // Check existing rows to avoid duplicates
        const { data: existingCheck2 } = await supabase
          ?.from('inventory_locations')
          ?.select('location, sub_location')
          ?.eq('tenant_id', tenantId);
        const existingCheckSet2 = new Set(
          (existingCheck2 || [])?.map(r => `${r?.location}|||${r?.sub_location ?? ''}`)
        );
        const toInsertFinal = unique?.filter(r => {
          const key = `${r?.location}|||${r?.sub_location ?? ''}`;
          return !existingCheckSet2?.has(key);
        });
        if (toInsertFinal?.length > 0) {
          const { error } = await supabase?.from('inventory_locations')?.insert(toInsertFinal);
          if (error) {
            console.error('[inventoryStorage] migrateLocalStorageFolderTree insert error:', error?.message);
            return; // Don't mark as done if insert failed
          }
        }
      }
    }
    // Migration successful
    localStorage.removeItem(TREE_KEY);
    localStorage.setItem(MIGRATION_KEY, 'true');
    console.log('[inventoryStorage] Folder tree migrated to Supabase successfully.');
  } catch (err) {
    console.error('[inventoryStorage] migrateLocalStorageFolderTree exception:', err?.message);
  }
};
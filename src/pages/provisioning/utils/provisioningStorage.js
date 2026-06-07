/**
 * Provisioning Storage — Supabase CRUD for all provisioning tables.
 *
 * Required Supabase tables (create if not exists):
 *
 * provisioning_lists:
 *   id uuid pk, tenant_id uuid, trip_id uuid nullable,
 *   title text, status text, department text,
 *   created_by uuid, created_at timestamptz, updated_at timestamptz,
 *   notes text, supplier_id uuid nullable,
 *   estimated_cost numeric, actual_cost numeric, port_location text,
 *   is_private boolean default false, is_template boolean default false
 *
 * provisioning_items:
 *   id uuid pk, list_id uuid fk provisioning_lists,
 *   name text, category text, department text,
 *   quantity_ordered numeric, quantity_received numeric, unit text,
 *   estimated_unit_cost numeric, allergen_flags text[],
 *   source text, notes text, status text
 *
 * provisioning_suppliers:
 *   id uuid pk, tenant_id uuid, name text, email text,
 *   phone text, port_location text, department text, notes text
 *
 * provisioning_deliveries:
 *   id uuid pk, list_id uuid fk provisioning_lists,
 *   delivered_at timestamptz, delivery_note_url text,
 *   delivery_note_type text, parsed_data jsonb,
 *   discrepancies jsonb, received_by uuid,
 *   supplier_name text, supplier_phone text, supplier_email text,
 *   supplier_address text, order_ref text, order_date text,
 *   delivery_note_ref text, tenant_id uuid, received_at timestamptz,
 *   invoice_file_url text, total_cost numeric, port_location text
 */

import { supabase } from '../../../lib/supabaseClient';
import { sendNotification, NOTIFICATION_TYPES, SEVERITY } from '../../team-jobs-management/utils/notifications';
import { loadTrips, findTripByAnyId } from '../../trips-management-dashboard/utils/tripStorage';

// ── Constants ─────────────────────────────────────────────────────────────────

export const PROVISIONING_STATUS = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'pending_approval',
  SENT_TO_SUPPLIER: 'sent_to_supplier',
  PARTIALLY_DELIVERED: 'partially_delivered',
  DELIVERED_WITH_DISCREPANCIES: 'delivered_with_discrepancies',
  DELIVERED: 'delivered',
};

export const ITEM_STATUS = {
  DRAFT: 'draft',
  TO_ORDER: 'to_order',
  ORDERED: 'ordered',
  RECEIVED: 'received',
  PARTIAL: 'partial',
  NOT_RECEIVED: 'not_received',
};

export const PROVISION_DEPARTMENTS = ['Galley', 'Interior', 'Deck', 'Engineering', 'Admin'];

export const PROVISION_UNITS = ['each', 'kg', 'litre', 'box', 'bottle', 'case', 'tin', 'bag', 'pack', 'dozen'];

// TODO(backlog): PROVISION_CATEGORIES below duplicates CATEGORY_GROUPS in
// data/categories.js with diverging names (e.g. 'Dry Goods' vs 'Pantry & Dry
// Goods'). Unify in a future sprint.
export const PROVISION_CATEGORIES = {
  Galley: ['Dry Goods', 'Fresh Produce', 'Meat & Seafood', 'Dairy', 'Beverages', 'Alcohol', 'Condiments', 'Cleaning', 'Other'],
  Interior: ['Cleaning Supplies', 'Toiletries', 'Linen', 'Amenities', 'Office', 'Other'],
  Deck: ['Cleaning', 'Safety', 'Maintenance', 'Equipment', 'Other'],
  Engineering: ['Spares', 'Lubricants', 'Consumables', 'Safety', 'Other'],
  Admin: ['Stationery', 'Medical', 'Safety', 'Other'],
};

// ── Inventory location hierarchy ──────────────────────────────────────────────

/**
 * Fetch all non-archived inventory_locations sub-location rows for a given
 * department (location column value).  Returns the raw rows so callers can
 * slice the hierarchy at any depth client-side.
 *
 * Schema: inventory_locations.location = department name
 *         inventory_locations.sub_location = null (root) | 'L2' | 'L2 > L3' | …
 *
 * Requires column: provisioning_items.accounting_description text DEFAULT ''
 *   ALTER TABLE public.provisioning_items
 *     ADD COLUMN IF NOT EXISTS accounting_description text DEFAULT '';
 */
/**
 * Fetch ALL location paths for a tenant (no department filter).
 * Returns a flat string[] of full paths like ["Bar > Main Bar", "Bar > Main Bar > Wine Fridge"].
 * Used for the location picker in the receive delivery flow.
 */
export const fetchAllInventoryLocations = async (tenantId) => {
  if (!tenantId) return [];
  try {
    const { data, error } = await supabase
      ?.from('inventory_locations')
      ?.select('location, sub_location')
      ?.eq('tenant_id', tenantId)
      ?.neq('is_archived', true)
      ?.order('sort_order', { ascending: true });
    if (error) throw error;
    // Collect all distinct top-level location names (including rows with no sub_location)
    const topLevel = [...new Set((data || []).map(r => r.location).filter(Boolean))];
    // Sub-location paths: "Location > Sub Location"
    const paths = (data || [])
      .filter(r => r.sub_location)
      .map(r => `${r.location} > ${r.sub_location}`);
    return [...new Set([...topLevel, ...paths])];
  } catch {
    return [];
  }
};

export const fetchInventoryLocationChildren = async (tenantId, location) => {
  if (!tenantId || !location) return [];
  try {
    const { data, error } = await supabase
      ?.from('inventory_locations')
      ?.select('location, sub_location, sort_order')
      ?.eq('tenant_id', tenantId)
      ?.eq('location', location)
      ?.not('sub_location', 'is', null)
      ?.neq('is_archived', true)
      ?.order('sort_order', { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn('[provisioningStorage] fetchInventoryLocationChildren error:', err);
    return [];
  }
};

// ── Vessel departments ────────────────────────────────────────────────────────

/**
 * Fetch active departments for this tenant via the get_tenant_departments RPC.
 * Falls back to vessels.departments_in_use (a uuid[]) if the RPC fails,
 * resolving those ids to names via the shared departments table.
 * Returns { id, name, color }[] sorted by name.
 */
export const fetchVesselDepartments = async (tenantId) => {
  if (!tenantId) return [];
  try {
    // Preferred: use the RPC which returns all departments from the shared table
    const { data: rpcData, error: rpcErr } = await supabase
      ?.rpc('get_tenant_departments', { p_tenant_id: tenantId });
    if (!rpcErr && Array.isArray(rpcData) && rpcData.length > 0) {
      return rpcData
        .filter(d => d?.name)
        .map(d => ({ id: d.id ?? null, name: d.name, color: d.color || '#5F5E5A' }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
  } catch { /* fall through to legacy approach */ }

  // Legacy fallback: departments_in_use is a uuid[] — resolve ids → names
  // via the shared departments table.
  try {
    const { data, error } = await supabase
      ?.from('vessels')
      ?.select('departments_in_use')
      ?.eq('tenant_id', tenantId)
      ?.limit(1)
      ?.single();
    const ids = Array.isArray(data?.departments_in_use) ? data.departments_in_use : [];
    if (error || ids.length === 0) return [];
    const { data: deptRows } = await supabase
      ?.from('departments')
      ?.select('id, name, color')
      ?.in('id', ids);
    if (!Array.isArray(deptRows)) return [];
    return deptRows
      .filter(d => d?.name)
      .map(d => ({ id: d.id ?? null, name: d.name, color: d.color || '#5F5E5A' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.warn('[provisioningStorage] fetchVesselDepartments error:', err);
    return [];
  }
};

// ── Lists ─────────────────────────────────────────────────────────────────────

export const fetchProvisioningLists = async (vesselId, userId = null, userDeptId = null, userTier = null) => {
  try {
    // Build visibility filter when userId is provided (app-level backup for environments
    // where RLS may not be fully configured). With RLS enabled this is redundant but harmless.
    const buildQuery = async (base) => {
      if (!userId) return base; // no filter — rely entirely on RLS

      // Collect list IDs the user is a collaborator on
      let collabListIds = [];
      try {
        const { data: collabData } = await supabase
          ?.from('provisioning_list_collaborators')
          ?.select('list_id')
          ?.eq('user_id', userId);
        collabListIds = (collabData || []).map(c => c.list_id);
      } catch { /* ignore — not fatal */ }

      // Build OR filter: owner OR dept-visibility OR collaborator
      const orParts = [`owner_id.eq.${userId}`, `created_by.eq.${userId}`];
      const tier = (userTier || '').toUpperCase();
      if (tier === 'COMMAND') {
        // COMMAND sees all department boards in the tenant
        orParts.push('visibility.eq.department');
      } else if (userDeptId) {
        // Other tiers see only their own department's boards
        orParts.push(`and(visibility.eq.department,department_id.eq.${userDeptId})`);
      }
      if (collabListIds.length) {
        orParts.push(`id.in.(${collabListIds.join(',')})`);
      }
      return base?.or(orParts.join(','));
    };

    // Try ordering by sort_order first
    let query = supabase
      ?.from('provisioning_lists')
      ?.select('*')
      ?.eq('tenant_id', vesselId)
      ?.order('sort_order', { ascending: true, nullsFirst: false })
      ?.order('created_at', { ascending: true });

    query = await buildQuery(query);
    const { data, error } = await query;

    // Graceful fallback if sort_order column doesn't exist yet
    if (error) {
      const isMissingColumn = error.code === '42703' || error.code === 'PGRST204' || error.message?.includes('sort_order');
      if (isMissingColumn) {
        console.warn('[provisioningStorage] sort_order column missing — run migration. Falling back to created_at order.');
        let fbQuery = supabase
          ?.from('provisioning_lists')
          ?.select('*')
          ?.eq('tenant_id', vesselId)
          ?.order('created_at', { ascending: false });
        fbQuery = await buildQuery(fbQuery);
        const { data: fallback, error: fbErr } = await fbQuery;
        if (fbErr) throw fbErr;
        return fallback || [];
      }
      throw error;
    }
    return data || [];
  } catch (err) {
    console.error('[provisioningStorage] fetchProvisioningLists error:', err);
    throw err;
  }
};

export const fetchProvisioningListsByTrip = async (tripId) => {
  try {
    const { data, error } = await supabase
      ?.from('provisioning_lists')
      ?.select('*')
      ?.eq('trip_id', tripId)
      ?.order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[provisioningStorage] fetchProvisioningListsByTrip error:', err);
    throw err;
  }
};

export const fetchProvisioningList = async (listId) => {
  try {
    const { data, error } = await supabase
      ?.from('provisioning_lists')
      ?.select('*')
      ?.eq('id', listId)
      ?.single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('[provisioningStorage] fetchProvisioningList error:', err);
    throw err;
  }
};

export const createProvisioningList = async (listData) => {
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      ?.from('provisioning_lists')
      ?.insert([{ ...listData, created_at: now, updated_at: now }])
      ?.select()
      ?.single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('[provisioningStorage] createProvisioningList error:', err);
    throw err;
  }
};

export const updateProvisioningList = async (listId, updates) => {
  try {
    const { data, error } = await supabase
      ?.from('provisioning_lists')
      ?.update({ ...updates, updated_at: new Date().toISOString() })
      ?.eq('id', listId)
      ?.select()
      ?.single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('[provisioningStorage] updateProvisioningList error:', err);
    throw err;
  }
};

export const deleteProvisioningList = async (listId) => {
  try {
    const { data, error } = await supabase
      ?.rpc('delete_provisioning_board', { p_list_id: listId });
    if (error) throw error;
    if (data === false) throw new Error('Board not found or already deleted.');
  } catch (err) {
    console.error('[provisioningStorage] deleteProvisioningList error:', err);
    throw err;
  }
};

// ── Items ─────────────────────────────────────────────────────────────────────

export const fetchListItems = async (listId) => {
  try {
    const { data, error } = await supabase
      ?.from('provisioning_items')
      ?.select('*')
      ?.eq('list_id', listId)
      ?.order('name');
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[provisioningStorage] fetchListItems error:', err);
    throw err;
  }
};

export const updateProvisioningItem = async (itemId, updates) => {
  try {
    const { data, error } = await supabase
      ?.from('provisioning_items')
      ?.update(updates)
      ?.eq('id', itemId)
      ?.select()
      ?.single();
    if (error) {
      console.error('[provisioningStorage] updateProvisioningItem error:', JSON.stringify(error), 'itemId:', itemId, 'updates:', updates);
      throw error;
    }
    return data;
  } catch (err) {
    console.error('[provisioningStorage] updateProvisioningItem caught:', err);
    throw err;
  }
};

// Sprint 9c.3 Phase 8 5b — bulk back-fill the structured supplier link
// on a set of provisioning_items (used when the SendToSupplierModal
// "Unassigned" bucket assigns a supplier to its items at send time).
// { data, error }, no throw — caller treats failure as non-fatal.
export const setItemsSupplierProfile = async (itemIds, supplierProfileId, supplierName = null) => {
  if (!itemIds || itemIds.length === 0) return { data: [], error: null };
  const patch = { supplier_profile_id: supplierProfileId || null };
  if (supplierName != null) patch.supplier_name = supplierName;
  const { data, error } = await supabase
    .from('provisioning_items')
    .update(patch)
    .in('id', itemIds)
    .select('id');
  return { data: data || [], error };
};

export const upsertItems = async (items) => {
  try {
    const { data, error } = await supabase
      ?.from('provisioning_items')
      ?.upsert(items, { onConflict: 'id' })
      ?.select();
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[provisioningStorage] upsertItems error:', err);
    throw err;
  }
};

export const deleteProvisioningItem = async (itemId) => {
  try {
    const { error } = await supabase
      ?.from('provisioning_items')
      ?.delete()
      ?.eq('id', itemId);
    if (error) throw error;
  } catch (err) {
    console.error('[provisioningStorage] deleteProvisioningItem error:', err);
    throw err;
  }
};

// Atomic bulk delete — single roundtrip via .in('id', itemIds). Used by
// the items-list bulk action bar's Delete verb. Returns nothing; throws
// on RLS or network failure so the caller can revert the optimistic
// local state.
export const bulkDeleteProvisioningItems = async (itemIds) => {
  if (!Array.isArray(itemIds) || itemIds.length === 0) return;
  const { error } = await supabase
    ?.from('provisioning_items')
    ?.delete()
    ?.in('id', itemIds);
  if (error) {
    console.error('[provisioningStorage] bulkDeleteProvisioningItems error:', error);
    throw error;
  }
};

export const updateItemStatus = async (itemId, status, quantityReceived, ledgerCtx = null) => {
  try {
    const updates = { status };
    if (quantityReceived !== undefined) updates.quantity_received = quantityReceived;
    const { data, error } = await supabase
      ?.from('provisioning_items')
      ?.update(updates)
      ?.eq('id', itemId)
      ?.select()
      ?.single();
    if (error) throw error;

    // Write to ledger when marked received and caller supplies context
    if (status === 'received' && ledgerCtx?.tenantId && data) {
      createLedgerEntry({
        tenantId:      ledgerCtx.tenantId,
        sourceType:    'manual',
        sourceBoardId: data.list_id || ledgerCtx.boardId || null,
        receivedBy:    ledgerCtx.userId || null,
        items: [{
          raw_name:        data.name || 'Unknown item',
          quantity:        quantityReceived ?? data.quantity_ordered ?? 1,
          unit:            data.unit || null,
          unit_price:      data.estimated_unit_cost || null,
          claimed_board_id: data.list_id || ledgerCtx.boardId || null,
          claimed_item_id:  itemId,
          match_confidence: 'high',
        }],
      }).catch(err => console.error('[updateItemStatus] ledger write error:', err));
    }

    return data;
  } catch (err) {
    console.error('[provisioningStorage] updateItemStatus error:', err);
    throw err;
  }
};

/**
 * Batch-update quantity_received + status for multiple items using proper UPDATEs
 * (not upsert, to avoid the NOT NULL `name` constraint on the INSERT path).
 */
export const receiveItems = async (updates) => {
  // updates: [{ id, quantity_received, status, receive_batch_id? }]
  const results = await Promise.allSettled(
    updates.map(({ id, quantity_received, status, receive_batch_id }) => {
      const fields = { quantity_received, status };
      if (receive_batch_id != null) fields.receive_batch_id = receive_batch_id;
      return supabase
        ?.from('provisioning_items')
        ?.update(fields)
        ?.eq('id', id)
        ?.select()
        ?.single();
    })
  );
  const errors = results.filter(r => r.status === 'rejected' || r.value?.error);
  if (errors.length) {
    console.error('[provisioningStorage] receiveItems partial errors:', errors);
    if (errors.length === updates.length) throw new Error('All receive updates failed');
  }
  return results
    .filter(r => r.status === 'fulfilled' && r.value?.data)
    .map(r => r.value.data);
};

// ── Suppliers ─────────────────────────────────────────────────────────────────
//
// Sprint 9c.3 Phase 8 (Batch 1 — read repoint): the legacy
// provisioning_suppliers table is consolidated into supplier_profiles.
// fetchSuppliers now reads supplier_profiles and maps each row back to
// the legacy provisioning_suppliers shape so the ~5 existing read
// consumers (provisioning form/board/detail pickers, legacy directory,
// list dashboard, send-to-supplier modal) keep working untouched.
//
// Field mapping (supplier_profiles → legacy provisioning_suppliers):
//   contact_email  → email
//   contact_phone  → phone
//   business_city  → port_location   (Phase 2 migration mapping)
//   categories[]   → department      (Phase 2 migrated department→categories[])
// id / tenant_id / name / notes are 1:1. Archived (soft-deleted)
// profiles are excluded — they must not surface in supplier pickers
// (legacy table had no archive concept; this is the intended modern
// behaviour, not a regression). createSupplier / updateSupplier /
// deleteSupplier still hit the legacy table — repointed in Batch 2/3.

const toLegacySupplierShape = (row) => ({
  id: row.id,
  tenant_id: row.tenant_id,
  name: row.name,
  email: row.contact_email ?? null,
  phone: row.contact_phone ?? null,
  port_location: row.business_city ?? null,
  department: Array.isArray(row.categories) ? row.categories : [],
  notes: row.notes ?? null,
  _legacy_shape: true,
});

export const fetchSuppliers = async (vesselId) => {
  try {
    const { data, error } = await supabase
      ?.from('supplier_profiles')
      ?.select('id, tenant_id, name, contact_email, contact_phone, business_city, categories, notes, archived_at')
      ?.eq('tenant_id', vesselId)
      ?.is('archived_at', null)
      ?.order('name');
    if (error) throw error;
    return (data || []).map(toLegacySupplierShape);
  } catch (err) {
    console.error('[provisioningStorage] fetchSuppliers error:', err);
    throw err;
  }
};

// Sprint 9c.3 Phase 8 Batch 2 — the write helpers now target
// supplier_profiles via the Phase 3 vendor helpers, but keep the
// legacy call/return shape so the only remaining caller (the legacy
// ProvisioningSuppliers directory + SendToSupplierModal "+ add new")
// is untouched. Throw-on-error contract preserved.
//
// Legacy `department` was a single string (legacy form <select>) or a
// text[]; supplier_profiles models it as categories[] + primary_category.

const legacyDepartmentToCategories = (dept) =>
  Array.isArray(dept) ? dept.filter(Boolean) : (dept ? [dept] : []);

const legacyToProfilePayload = (s) => {
  const categories = legacyDepartmentToCategories(s.department);
  return {
    tenant_id:        s.tenant_id,
    name:             s.name,
    contact_email:    s.email || null,
    contact_phone:    s.phone || null,
    business_city:    s.port_location || null,
    categories,
    primary_category: categories[0] || null,
    notes:            s.notes || null,
    vendor_type:      'Supplier',
    is_favourite:     false,
    archived_at:      null,
  };
};

const legacyPatchToProfile = (u) => {
  const p = {};
  if ('name' in u) p.name = u.name;
  if ('email' in u) p.contact_email = u.email || null;
  if ('phone' in u) p.contact_phone = u.phone || null;
  if ('port_location' in u) p.business_city = u.port_location || null;
  if ('notes' in u) p.notes = u.notes || null;
  if ('department' in u) {
    const categories = legacyDepartmentToCategories(u.department);
    p.categories = categories;
    p.primary_category = categories[0] || null;
  }
  return p;
};

// caller MUST supply tenant_id (crew_insert_supplier_profiles RLS).
export const createSupplier = async (supplierData) => {
  const { data, error } = await createVendor(legacyToProfilePayload(supplierData));
  if (error) {
    console.error('[provisioningStorage] createSupplier error:', error);
    throw error;
  }
  return toLegacySupplierShape(data);
};

export const updateSupplier = async (supplierId, updates) => {
  const { data, error } = await updateVendor(supplierId, legacyPatchToProfile(updates));
  if (error) {
    console.error('[provisioningStorage] updateSupplier error:', error);
    throw error;
  }
  return toLegacySupplierShape(data);
};

// Soft-delete (archived_at = now) — NOT a hard delete. A hard delete
// would orphan provisioning_lists.supplier_id / supplier_orders FKs.
// Matches the directory's archive behaviour.
export const deleteSupplier = async (supplierId) => {
  const { error } = await archiveVendor(supplierId);
  if (error) {
    console.error('[provisioningStorage] deleteSupplier error:', error);
    throw error;
  }
};

// ── Deliveries ────────────────────────────────────────────────────────────────

export const fetchDeliveries = async (listId) => {
  try {
    const { data, error } = await supabase
      ?.from('provisioning_deliveries')
      ?.select('*')
      ?.eq('list_id', listId)
      ?.order('delivered_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[provisioningStorage] fetchDeliveries error:', err);
    throw err;
  }
};

export const createDelivery = async (deliveryData) => {
  try {
    const { data, error } = await supabase
      ?.from('provisioning_deliveries')
      ?.insert([{ ...deliveryData, delivered_at: deliveryData.delivered_at || new Date().toISOString() }])
      ?.select()
      ?.single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('[provisioningStorage] createDelivery error:', err);
    throw err;
  }
};

// ── Status update (for kanban drag) ───────────────────────────────────────────

export const updateListStatus = async (listId, status) => {
  try {
    const { data, error } = await supabase
      ?.from('provisioning_lists')
      ?.update({ status, updated_at: new Date().toISOString() })
      ?.eq('id', listId)
      ?.select()
      ?.single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('[provisioningStorage] updateListStatus error:', err);
    throw err;
  }
};

// ── Templates ──────────────────────────────────────────────────────────────────

export const fetchTemplates = async (vesselId) => {
  try {
    const { data, error } = await supabase
      ?.from('provisioning_lists')
      ?.select('*')
      ?.eq('tenant_id', vesselId)
      ?.eq('is_template', true)
      ?.order('updated_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[provisioningStorage] fetchTemplates error:', err);
    return [];
  }
};

export const saveAsTemplate = async (listId, isTemplate) => {
  try {
    const { data, error } = await supabase
      ?.from('provisioning_lists')
      ?.update({ is_template: isTemplate, updated_at: new Date().toISOString() })
      ?.eq('id', listId)
      ?.select()
      ?.single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('[provisioningStorage] saveAsTemplate error:', err);
    throw err;
  }
};

// ── Master Order History ───────────────────────────────────────────────────────

export const fetchMasterOrderHistory = async (vesselId, { userDeptName = null, isCommand = false } = {}) => {
  try {
    // Aggregate the "frequently-ordered" signal across boards whose items
    // were actually sent to a supplier (or further along the lifecycle).
    // Exclude 'draft' and 'pending_approval' because items in unsent
    // drafts haven't actually been ordered — counting them would inflate
    // the times_ordered signal with intent, not history. Including
    // 'ordered', 'sent_to_supplier', 'partially_delivered',
    // 'delivered_with_discrepancies', and 'delivered' gives crew the
    // honest "what we've actually shipped" surface.
    //
    // Prior to this change the filter was `.eq('status', 'delivered')`
    // alone, which meant Order History silently empty until a board
    // fully completed its lifecycle. Caused the Quick Add Order History
    // tab to read "No order history found" on tenants with active
    // shipping orders.
    //
    // Dept-scoping (Quick Add Frequent Items tab): non-COMMAND callers
    // receive items filtered to their own department only — same
    // mental model as the Favourites/Past Orders RPCs. COMMAND keeps
    // tenant-wide visibility because they routinely browse cross-dept
    // for budgeting / oversight. Caller passes userDeptName + isCommand
    // from useAuth(); helper handles the rest. Backwards-compatible:
    // callers that omit the options object see tenant-wide as before.
    const { data: lists, error: listsErr } = await supabase
      ?.from('provisioning_lists')
      ?.select('id, title')
      ?.eq('tenant_id', vesselId)
      ?.in('status', [
        'ordered',
        'sent_to_supplier',
        'partially_delivered',
        'delivered_with_discrepancies',
        'delivered',
      ]);
    if (listsErr) throw listsErr;
    if (!lists?.length) return [];

    const listIds = lists.map(l => l.id);

    let itemsQuery = supabase
      ?.from('provisioning_items')
      ?.select('id, list_id, name, brand, size, category, sub_category, department, quantity_ordered, unit, created_at')
      ?.in('list_id', listIds);
    if (!isCommand && userDeptName) {
      itemsQuery = itemsQuery?.eq('department', userDeptName);
    }
    const { data: items, error: itemsErr } = await itemsQuery?.order('name');
    if (itemsErr) throw itemsErr;

    // Group and aggregate by name+brand+size key
    const historyMap = {};
    (items || []).forEach(item => {
      const key = `${(item.name || '').toLowerCase()}|${(item.brand || '').toLowerCase()}|${(item.size || '').toLowerCase()}`;
      if (!historyMap[key]) {
        historyMap[key] = {
          name: item.name,
          brand: item.brand || '',
          size: item.size || '',
          category: item.category || '',
          sub_category: item.sub_category || '',
          department: item.department || '',
          unit: item.unit || 'each',
          times_ordered: 0,
          quantities: [],
          last_ordered: null,
        };
      }
      historyMap[key].times_ordered += 1;
      if (item.quantity_ordered) historyMap[key].quantities.push(parseFloat(item.quantity_ordered));
      const d = item.created_at ? new Date(item.created_at) : null;
      if (d && (!historyMap[key].last_ordered || d > historyMap[key].last_ordered)) {
        historyMap[key].last_ordered = d;
      }
    });

    return Object.values(historyMap).map(h => ({
      ...h,
      avg_quantity: h.quantities.length
        ? Math.round((h.quantities.reduce((s, q) => s + q, 0) / h.quantities.length) * 10) / 10
        : null,
      last_quantity: h.quantities[h.quantities.length - 1] || null,
      last_ordered_date: h.last_ordered,
    })).sort((a, b) => b.times_ordered - a.times_ordered);
  } catch (err) {
    console.error('[provisioningStorage] fetchMasterOrderHistory error:', err);
    return [];
  }
};

// ── Duplicate list ─────────────────────────────────────────────────────────────

export const duplicateList = async (sourceListId, vesselId, userId) => {
  try {
    const [list, items] = await Promise.all([
      fetchProvisioningList(sourceListId),
      fetchListItems(sourceListId),
    ]);
    if (!list) throw new Error('Source list not found');

    const { id: _id, created_at: _ca, updated_at: _ua, ...listFields } = list;
    const newList = await createProvisioningList({
      ...listFields,
      tenant_id: vesselId,
      title: `${list.title} Copy`,
      status: PROVISIONING_STATUS.DRAFT,
      is_template: false,
      created_by: userId,
    });

    if (items?.length) {
      const itemPayload = items.map(({ id: _iid, created_at: _ic, ...item }) => ({
        ...item,
        list_id: newList.id,
        status: ITEM_STATUS.PENDING,
        quantity_received: null,
      }));
      await upsertItems(itemPayload);
    }

    return newList;
  } catch (err) {
    console.error('[provisioningStorage] duplicateList error:', err);
    throw err;
  }
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export const computeListStatusAfterDelivery = (items) => {
  if (!items?.length) return PROVISIONING_STATUS.DELIVERED;
  const notReceived = items.filter(i => i.status === ITEM_STATUS.NOT_RECEIVED);
  const partial = items.filter(i => i.status === ITEM_STATUS.PARTIAL);
  if (notReceived.length === items.length) return PROVISIONING_STATUS.PARTIALLY_DELIVERED;
  if (notReceived.length > 0 || partial.length > 0) return PROVISIONING_STATUS.DELIVERED_WITH_DISCREPANCIES;
  return PROVISIONING_STATUS.DELIVERED;
};

export const formatCurrency = (amount, currency = 'USD') => {
  if (!amount && amount !== 0) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0 }).format(amount);
};

// ── Share links ───────────────────────────────────────────────────────────────

/** Create a shareable link for a board. Returns the new share row (with .token). */
export const createShareLink = async (listId, permission = 'view', createdBy = null) => {
  try {
    const { data, error } = await supabase
      ?.from('provisioning_list_shares')
      ?.insert({ list_id: listId, permission, created_by: createdBy })
      ?.select()
      ?.single();
    if (error) { console.error('[provisioningStorage] createShareLink error:', error.message); return null; }
    return data;
  } catch (err) {
    console.error('[provisioningStorage] createShareLink exception:', err.message);
    return null;
  }
};

/** Fetch all active (non-revoked) share links for a board. */
export const fetchShareLinks = async (listId) => {
  try {
    const { data, error } = await supabase
      ?.from('provisioning_list_shares')
      ?.select('id, token, permission, created_at, last_accessed_at')
      ?.eq('list_id', listId)
      ?.is('revoked_at', null)
      ?.order('created_at', { ascending: false });
    if (error) { console.error('[provisioningStorage] fetchShareLinks error:', error.message); return []; }
    return data || [];
  } catch (err) {
    console.error('[provisioningStorage] fetchShareLinks exception:', err.message);
    return [];
  }
};

/** Revoke (soft-delete) a share link by its row id. */
export const revokeShareLink = async (shareId) => {
  try {
    const { error } = await supabase
      ?.from('provisioning_list_shares')
      ?.update({ revoked_at: new Date().toISOString() })
      ?.eq('id', shareId);
    if (error) { console.error('[provisioningStorage] revokeShareLink error:', error.message); return false; }
    return true;
  } catch (err) {
    console.error('[provisioningStorage] revokeShareLink exception:', err.message);
    return false;
  }
};

// ── Collaborators ─────────────────────────────────────────────────────────────

/** Add a crew member as a collaborator. Returns the new row or null. */
export const addCollaborator = async (listId, userId, permission = 'view', addedBy = null) => {
  try {
    const { data, error } = await supabase
      ?.from('provisioning_list_collaborators')
      ?.upsert({ list_id: listId, user_id: userId, permission, added_by: addedBy }, { onConflict: 'list_id,user_id' })
      ?.select()
      ?.single();
    if (error) { console.error('[provisioningStorage] addCollaborator error:', error.message); return null; }
    return data;
  } catch (err) {
    console.error('[provisioningStorage] addCollaborator exception:', err.message);
    return null;
  }
};

/** Update a collaborator's permission level. */
export const updateCollaboratorPermission = async (listId, userId, permission) => {
  try {
    const { error } = await supabase
      ?.from('provisioning_list_collaborators')
      ?.update({ permission })
      ?.eq('list_id', listId)
      ?.eq('user_id', userId);
    if (error) { console.error('[provisioningStorage] updateCollaboratorPermission error:', error.message); return false; }
    return true;
  } catch (err) {
    console.error('[provisioningStorage] updateCollaboratorPermission exception:', err.message);
    return false;
  }
};

/** Remove a collaborator from a board. */
export const removeCollaborator = async (listId, userId) => {
  try {
    const { error } = await supabase
      ?.from('provisioning_list_collaborators')
      ?.delete()
      ?.eq('list_id', listId)
      ?.eq('user_id', userId);
    if (error) { console.error('[provisioningStorage] removeCollaborator error:', error.message); return false; }
    return true;
  } catch (err) {
    console.error('[provisioningStorage] removeCollaborator exception:', err.message);
    return false;
  }
};

/**
 * Fetch collaborators for a board, joined with profile data (name, email, avatar).
 * Returns array of { id, user_id, permission, added_at, full_name, email, avatar_url }.
 */
export const fetchCollaborators = async (listId) => {
  try {
    const { data, error } = await supabase
      ?.from('provisioning_list_collaborators')
      ?.select('id, user_id, permission, added_at, profiles!provisioning_list_collaborators_user_id_fkey(full_name, email, avatar_url)')
      ?.eq('list_id', listId)
      ?.order('added_at', { ascending: true });
    if (error) { console.error('[provisioningStorage] fetchCollaborators error:', error.message); return []; }
    return (data || []).map(row => ({
      id: row.id,
      user_id: row.user_id,
      permission: row.permission,
      added_at: row.added_at,
      full_name: row.profiles?.full_name || null,
      email: row.profiles?.email || null,
      avatar_url: row.profiles?.avatar_url || null,
    }));
  } catch (err) {
    console.error('[provisioningStorage] fetchCollaborators exception:', err.message);
    return [];
  }
};

/**
 * Fetch all boards shared with a given user (via collaborators table),
 * including the list details. Used for "Shared with me" section.
 */
export const fetchCrewMembers = async (tenantId) => {
  try {
    const { data, error } = await supabase
      ?.from('tenant_members')
      ?.select('user_id, profiles!tenant_members_user_id_fkey(full_name, email, avatar_url)')
      ?.eq('tenant_id', tenantId)
      ?.eq('active', true);
    if (error) { console.error('[provisioningStorage] fetchCrewMembers error:', error.message); return []; }
    return (data || []).map(row => ({
      id: row.user_id,
      full_name: row.profiles?.full_name || null,
      email: row.profiles?.email || null,
      avatar_url: row.profiles?.avatar_url || null,
    })).filter(m => m.id);
  } catch (err) {
    console.error('[provisioningStorage] fetchCrewMembers exception:', err.message);
    return [];
  }
};

export const fetchSharedWithMe = async (userId) => {
  try {
    const { data, error } = await supabase
      ?.from('provisioning_list_collaborators')
      ?.select('permission, provisioning_lists(id, title, status, board_colour, department, order_by_date, tenant_id, created_by)')
      ?.eq('user_id', userId)
      ?.not('provisioning_lists', 'is', null);
    if (error) { console.error('[provisioningStorage] fetchSharedWithMe error:', error.message); return []; }
    return (data || []).map(row => ({
      ...row.provisioning_lists,
      myPermission: row.permission,
    }));
  } catch (err) {
    console.error('[provisioningStorage] fetchSharedWithMe exception:', err.message);
    return [];
  }
};

// ── Receive-delivery helpers ───────────────────────────────────────────────────

/**
 * Match a provisioning item to an existing inventory_items row.
 * Priority: inventory_item_id → cargo_item_id → barcode → exact name (case-insensitive).
 * Returns the raw DB row or null.
 */
export const findMatchingInventoryItem = async (provItem, tenantId) => {
  if (!tenantId) return null;
  try {
    // 1. Direct FK link (already resolved on a previous delivery)
    if (provItem?.inventory_item_id) {
      const { data } = await supabase
        ?.from('inventory_items')
        ?.select('id, name, brand, size, unit, cargo_item_id, barcode, stock_locations, location, sub_location, total_qty, unit_cost, currency')
        ?.eq('id', provItem.inventory_item_id)
        ?.eq('tenant_id', tenantId)
        ?.maybeSingle();
      if (data) return data;
    }
    // 2. cargo_item_id
    if (provItem?.cargo_item_id) {
      const { data } = await supabase
        ?.from('inventory_items')
        ?.select('id, name, brand, size, unit, cargo_item_id, barcode, stock_locations, location, sub_location, total_qty, unit_cost, currency')
        ?.eq('cargo_item_id', provItem.cargo_item_id)
        ?.eq('tenant_id', tenantId)
        ?.maybeSingle();
      if (data) return data;
    }
    // 3. barcode
    if (provItem?.barcode) {
      const { data } = await supabase
        ?.from('inventory_items')
        ?.select('id, name, brand, size, unit, cargo_item_id, barcode, stock_locations, location, sub_location, total_qty, unit_cost, currency')
        ?.eq('barcode', provItem.barcode)
        ?.eq('tenant_id', tenantId)
        ?.maybeSingle();
      if (data) return data;
    }
    // 4. name + brand + size — ALL three must be present and match exactly
    if (provItem?.name && provItem?.brand && provItem?.size) {
      const { data } = await supabase
        ?.from('inventory_items')
        ?.select('id, name, brand, size, unit, cargo_item_id, barcode, stock_locations, location, sub_location, total_qty, unit_cost, currency')
        ?.ilike('name', provItem.name.trim())
        ?.ilike('brand', provItem.brand.trim())
        ?.ilike('size', provItem.size.trim())
        ?.eq('tenant_id', tenantId)
        ?.maybeSingle();
      if (data) return data;
    }
    return null;
  } catch (err) {
    console.error('[provisioningStorage] findMatchingInventoryItem error:', err.message);
    return null;
  }
};

/**
 * Add received qty to an inventory item's stock at a named location.
 * Creates a new location entry if no matching one exists.
 * Also updates total_qty and last_provisioning_date.
 */
export const pushReceivedQtyToLocation = async ({ inventoryItemId, locationName, qtyToAdd, tenantId }) => {
  if (!inventoryItemId || !tenantId || !qtyToAdd) return false;
  try {
    // Fetch current stock_locations
    const { data: item, error: fetchErr } = await supabase
      ?.from('inventory_items')
      ?.select('stock_locations, total_qty')
      ?.eq('id', inventoryItemId)
      ?.eq('tenant_id', tenantId)
      ?.single();
    if (fetchErr) throw fetchErr;

    let locs = Array.isArray(item?.stock_locations) ? [...item.stock_locations] : [];
    const normName = (locationName || '').trim();
    const idx = locs.findIndex(l =>
      (l?.locationName || l?.name || '').toLowerCase() === normName.toLowerCase()
    );
    if (idx >= 0) {
      const existing = locs[idx];
      locs[idx] = { ...existing, qty: (existing?.qty ?? existing?.quantity ?? 0) + qtyToAdd };
    } else {
      locs.push({ locationName: normName, locationId: '', qty: qtyToAdd });
    }
    const newTotal = locs.reduce((s, l) => s + (l?.qty ?? l?.quantity ?? 0), 0);

    const { error: updateErr } = await supabase
      ?.from('inventory_items')
      ?.update({
        stock_locations: locs,
        total_qty: newTotal,
        last_provisioning_date: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      ?.eq('id', inventoryItemId)
      ?.eq('tenant_id', tenantId);
    if (updateErr) throw updateErr;
    return true;
  } catch (err) {
    console.error('[provisioningStorage] pushReceivedQtyToLocation error:', err.message);
    return false;
  }
};

/**
 * Create a new inventory item from provisioning data and link it.
 * Returns the created row id, or null on failure.
 */
export const createInventoryItemFromProvItem = async ({ provItem, categoryPath, storageLocations, locationName, qty, tenantId, userId }) => {
  if (!tenantId) return null;
  try {
    // categoryPath → inventory hierarchy (location + sub_location fields)
    // storageLocations → physical storage with qty splits
    const catPath = categoryPath || locationName || null;
    const stockLocations = storageLocations?.length > 0
      ? storageLocations
          .filter(s => (parseFloat(s.addQty) || 0) > 0 && (s.locationName || '').trim())
          .map(s => ({ locationName: s.locationName.trim(), locationId: '', qty: parseFloat(s.addQty) || 0 }))
      : locationName ? [{ locationName: locationName.trim(), locationId: '', qty: qty || 0 }] : [];
    const totalQty = storageLocations?.length > 0
      ? stockLocations.reduce((sum, l) => sum + (l.qty || 0), 0)
      : qty || 0;
    const { data, error } = await supabase
      ?.from('inventory_items')
      ?.insert({
        tenant_id: tenantId,
        created_by: userId || null,
        name: provItem?.name || '',
        brand: provItem?.brand || null,
        size: provItem?.size || null,
        unit: provItem?.unit || 'each',
        location: catPath?.split(' > ')?.[0]?.trim() || catPath || null,
        sub_location: catPath?.split(' > ')?.slice(1)?.join(' > ') || null,
        stock_locations: stockLocations,
        total_qty: totalQty,
        notes: provItem?.notes || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_provisioning_date: new Date().toISOString(),
      })
      ?.select('id, name, cargo_item_id')
      ?.single();
    if (error) throw error;

    // Link the provisioning item back to the new inventory item
    if (data?.id && provItem?.id && provItem?.list_id) {
      await supabase
        ?.from('provisioning_items')
        ?.update({ inventory_item_id: data.id })
        ?.eq('id', provItem.id);
    }
    return data;
  } catch (err) {
    console.error('[provisioningStorage] createInventoryItemFromProvItem error:', err.message);
    return null;
  }
};

/**
 * Push received qty to multiple locations in one atomic fetch+update.
 * splits: [{ locationName: string, addQty: number }]
 */
export const pushReceivedSplitsToInventory = async ({ inventoryItemId, splits, tenantId }) => {
  // Accept splits with a quantity — locationName is optional
  const activeSplits = (splits || []).filter(s => (parseFloat(s.addQty) || 0) > 0);
  if (!activeSplits.length || !inventoryItemId || !tenantId) return false;
  try {
    const { data: item, error: fetchErr } = await supabase
      ?.from('inventory_items')
      ?.select('stock_locations, total_qty')
      ?.eq('id', inventoryItemId)
      ?.eq('tenant_id', tenantId)
      ?.single();
    if (fetchErr) throw fetchErr;

    let locs = Array.isArray(item?.stock_locations) ? [...item.stock_locations] : [];
    let totalAdded = 0;

    for (const split of activeSplits) {
      const normName = (split.locationName || '').trim();
      const addQty = parseFloat(split.addQty) || 0;
      if (normName) {
        const idx = locs.findIndex(l => (l?.locationName || l?.name || '').toLowerCase() === normName.toLowerCase());
        if (idx >= 0) {
          const existing = locs[idx];
          locs[idx] = { ...existing, qty: (existing?.qty ?? existing?.quantity ?? 0) + addQty };
        } else {
          locs.push({ locationName: normName, locationId: '', qty: addQty });
        }
      }
      totalAdded += addQty;
    }

    const { error: updateErr } = await supabase
      ?.from('inventory_items')
      ?.update({
        stock_locations: locs,
        total_qty: (item.total_qty ?? 0) + totalAdded,
        last_provisioning_date: new Date().toISOString(),
      })
      ?.eq('id', inventoryItemId)
      ?.eq('tenant_id', tenantId);
    if (updateErr) throw updateErr;
    return true;
  } catch (err) {
    console.error('[provisioningStorage] pushReceivedSplitsToInventory error:', err.message);
    return false;
  }
};

// ── Vessel locations (physical storage) ──────────────────────────────────────
/**
 * Returns all active vessel_locations rows for a tenant.
 * Schema: { id, name, level ('deck'|'zone'|'space'), parent_id }
 * Parent-id based hierarchy: deck → zone → space
 */
export const fetchVesselLocations = async (tenantId) => {
  if (!tenantId) return [];
  try {
    const { data, error } = await supabase
      ?.from('vessel_locations')
      ?.select('id, name, level, parent_id')
      ?.eq('tenant_id', tenantId)
      ?.eq('is_archived', false)
      ?.order('sort_order', { ascending: true })
      ?.order('name', { ascending: true });
    if (error) throw error;
    return data || [];
  } catch {
    return [];
  }
};

// ── Search inventory items for linking ───────────────────────────────────────
export const searchInventoryItems = async (query, tenantId) => {
  if (!query || query.trim().length < 2 || !tenantId) return [];
  const q = query.trim();
  try {
    const { data, error } = await supabase
      ?.from('inventory_items')
      ?.select('id, name, brand, size, unit, cargo_item_id, barcode, unit_cost, total_qty, stock_locations, location, sub_location, l1_name, l2_name, l3_name, l4_name')
      ?.eq('tenant_id', tenantId)
      ?.or(`name.ilike.%${q}%,brand.ilike.%${q}%,cargo_item_id.ilike.%${q}%,barcode.ilike.%${q}%`)
      ?.limit(8);
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
};

/**
 * Fetch a single inventory item by id (for reading category/taxonomy fields).
 */
export const fetchInventoryItemById = async (id, tenantId) => {
  if (!id || !tenantId) return null;
  try {
    const { data, error } = await supabase
      ?.from('inventory_items')
      ?.select('id, name, l1_name, l2_name, l3_name, l4_name, location, sub_location, total_qty, stock_locations')
      ?.eq('id', id)
      ?.eq('tenant_id', tenantId)
      ?.maybeSingle();
    if (error) return null;
    return data || null;
  } catch {
    return null;
  }
};

// ── Delivery batch logging ────────────────────────────────────────────────────

/**
 * Log a delivery batch after receiving items.
 * receivedItems: array of { id, name, quantity_received, ... }
 */
/**
 * Create a delivery batch record in provisioning_deliveries.
 * Tries progressively simpler payloads to handle schemas where optional
 * columns (tenant_id, supplier_name, received_by, total_cost, port_location)
 * may not exist yet. Always returns the created row or null — never throws.
 */
export const createDeliveryBatch = async ({ listId, tenantId, userId, supplierName, totalCost, portLocation, invoiceFileUrl, supplierPhone, supplierEmail, supplierAddress, orderRef, orderDate, deliveryNoteRef }) => {
  if (!listId) return null;
  const ts = new Date().toISOString();
  const base = {
    list_id: listId,
    supplier_name: supplierName || 'Manual receive',
    received_at: ts,
    received_by: userId || null,
    ...(invoiceFileUrl ? { invoice_file_url: invoiceFileUrl } : {}),
  };
  // Optional metadata fields — include only if truthy so missing columns don't break inserts
  const meta = {};
  if (supplierPhone)    meta.supplier_phone   = supplierPhone;
  if (supplierEmail)    meta.supplier_email   = supplierEmail;
  if (supplierAddress)  meta.supplier_address = supplierAddress;
  if (orderRef)         meta.order_ref        = orderRef;
  if (orderDate)        meta.order_date       = orderDate;
  if (deliveryNoteRef)  meta.delivery_note_ref = deliveryNoteRef;
  // Ordered from most complete to bare minimum
  const attempts = [
    { ...base, ...meta, ...(tenantId ? { tenant_id: tenantId } : {}), ...(totalCost != null ? { total_cost: totalCost } : {}), ...(portLocation ? { port_location: portLocation } : {}) },
    { ...base, ...(totalCost != null ? { total_cost: totalCost } : {}), ...(portLocation ? { port_location: portLocation } : {}) },
    { ...base },
    { list_id: listId, received_at: ts },
  ];
  const errors = [];
  for (const [i, payload] of attempts.entries()) {
    try {
      console.log(`[createDeliveryBatch] attempt ${i + 1}:`, JSON.stringify(payload));
      const { data, error } = await supabase
        ?.from('provisioning_deliveries')
        ?.insert(payload)
        ?.select()
        ?.single();
      if (error) {
        console.error(`[createDeliveryBatch] attempt ${i + 1} error:`, error.code, error.message, error.details, error.hint);
        errors.push(`attempt ${i + 1}: [${error.code}] ${error.message}`);
        continue;
      }
      console.log(`[createDeliveryBatch] attempt ${i + 1} succeeded, id:`, data?.id);
      return data || null;
    } catch (err) {
      console.error(`[createDeliveryBatch] attempt ${i + 1} threw:`, err);
      errors.push(`attempt ${i + 1}: ${err?.message}`);
      continue;
    }
  }
  console.error('[createDeliveryBatch] ALL ATTEMPTS FAILED for list_id:', listId, '\n', errors.join('\n'));
  return null;
};

/**
 * Create retroactive batch records for received items that have no receive_batch_id.
 * Called when the Received tab loads and finds batches are missing.
 * Groups all unbatched received items into one "retroactive" batch.
 */
export const repairUnbatchedReceivedItems = async (listId, tenantId, userId) => {
  if (!listId) return false;
  try {
    // Find received items with no batch link
    const { data: unbatched, error: fetchErr } = await supabase
      ?.from('provisioning_items')
      ?.select('id')
      ?.eq('list_id', listId)
      ?.eq('status', 'received')
      ?.is('receive_batch_id', null);
    if (fetchErr || !unbatched?.length) return false;

    // Create one retroactive batch for all of them
    const batch = await createDeliveryBatch({ listId, tenantId, userId, supplierName: 'Manual receive' });
    if (!batch?.id) return false;

    // Stamp all unbatched received items with the new batch ID
    const { error: updateErr } = await supabase
      ?.from('provisioning_items')
      ?.update({ receive_batch_id: batch.id })
      ?.in('id', unbatched.map(r => r.id));
    if (updateErr) throw updateErr;
    return true;
  } catch (err) {
    console.error('[provisioningStorage] repairUnbatchedReceivedItems error:', err);
    return false;
  }
};

/** @deprecated — kept for callers that haven't migrated yet */
export const logDeliveryBatch = createDeliveryBatch;

/**
 * Quick-receive a single item from the Items tab checkbox:
 *  1. Finds or creates today's "Manual receive" batch for this board.
 *  2. Updates item: status=received, quantity_received=quantity_ordered,
 *     payment_status=awaiting_invoice, receive_batch_id=batch.id.
 * Returns the batch id (or null on failure).
 */
export const quickReceiveItem = async ({ item, listId, tenantId, userId }) => {
  console.log('[quickReceiveItem] called — item:', item?.id, 'listId:', listId, 'tenantId:', tenantId, 'userId:', userId);
  if (!item?.id || !listId) {
    console.warn('[quickReceiveItem] missing item.id or listId — aborting');
    return null;
  }
  if (!tenantId) {
    console.warn('[quickReceiveItem] tenantId is missing — will skip batch creation and still update item');
  }

  const qtyReceived = item.quantity_ordered ?? 0;
  const today = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"

  try {
    let batchId = null;

    // 1. Find today's Manual receive batch for this list
    const { data: existing, error: findErr } = await supabase
      ?.from('provisioning_deliveries')
      ?.select('id')
      ?.eq('list_id', listId)
      ?.eq('supplier_name', 'Manual receive')
      ?.gte('received_at', `${today}T00:00:00`)
      ?.lt('received_at', `${today}T23:59:59`)
      ?.order('received_at', { ascending: false })
      ?.limit(1)
      ?.maybeSingle();

    if (findErr) console.warn('[quickReceiveItem] batch lookup error:', findErr.message);
    batchId = existing?.id || null;
    console.log('[quickReceiveItem] existing batch today:', batchId);

    if (!batchId) {
      // 2. Create a new batch for today
      console.log('[quickReceiveItem] no existing batch — creating new one');
      const newBatch = await createDeliveryBatch({ listId, tenantId, userId, supplierName: 'Manual receive' });
      batchId = newBatch?.id || null;
      console.log('[quickReceiveItem] new batch id:', batchId);
    }

    // 3. Update the item
    console.log('[quickReceiveItem] updating item', item.id, 'with receive_batch_id:', batchId);
    await updateProvisioningItem(item.id, {
      status: 'received',
      quantity_received: qtyReceived,
      payment_status: 'awaiting_invoice',
      ...(batchId ? { receive_batch_id: batchId } : {}),
    });
    console.log('[quickReceiveItem] item updated successfully');

    // 4. Write to permanent delivery ledger (fire-and-forget)
    if (tenantId) {
      createLedgerEntry({
        tenantId,
        sourceType:      'manual',
        sourceBoardId:   listId,
        sourceBatchId:   batchId,
        supplierName:    'Manual receive',
        receivedBy:      userId,
        items: [{
          raw_name:        item.name,
          quantity:        qtyReceived,
          unit:            item.unit || null,
          unit_price:      item.estimated_unit_cost || null,
          claimed_board_id: listId,
          claimed_item_id:  item.id,
          match_confidence: 'high',
        }],
      }).catch(err => console.error('[quickReceiveItem] ledger write error:', err));
    }

    return batchId;
  } catch (err) {
    console.error('[quickReceiveItem] error:', err);
    return null;
  }
};

// Sprint 9c.3 Phase 8 Batch 2 commit 4 — fetchDistinctSuppliers
// removed. It queried provisioning_items.supplier_name which 400'd
// (the column the query filtered doesn't behave as assumed), and the
// only consumer (ItemDrawer's free-text datalist) is replaced by a
// structured supplier_profiles picker via fetchVendors().

/**
 * Fetch all delivery batches for a provisioning list, newest first.
 */
export const fetchDeliveryBatches = async (listId) => {
  if (!listId) return [];
  try {
    const { data, error } = await supabase
      ?.from('provisioning_deliveries')
      ?.select('id, supplier_name, received_at, received_by, invoice_file_url, total_cost, port_location, supplier_phone, supplier_email, supplier_address, order_ref, order_date, delivery_note_ref')
      ?.eq('list_id', listId)
      ?.order('received_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch {
    return [];
  }
};

/**
 * Recalculate and persist total_cost for a delivery batch from its linked items.
 * Called after payment status changes (paid items may use actual_unit_cost).
 */
export const updateBatchTotal = async (batchId) => {
  if (!batchId) return;
  try {
    const { data: batchItems, error: fetchErr } = await supabase
      ?.from('provisioning_items')
      ?.select('estimated_unit_cost, actual_unit_cost, quantity_received, payment_status')
      ?.eq('receive_batch_id', batchId);
    if (fetchErr || !batchItems?.length) return;
    const total = batchItems.reduce((sum, i) => {
      const isPaid = ['paid', 'paid_upfront'].includes(i.payment_status);
      const cost = isPaid && i.actual_unit_cost != null
        ? parseFloat(i.actual_unit_cost)
        : parseFloat(i.estimated_unit_cost) || 0;
      return sum + cost * (parseFloat(i.quantity_received) || 0);
    }, 0);
    await supabase
      ?.from('provisioning_deliveries')
      ?.update({ total_cost: total })
      ?.eq('id', batchId);
  } catch (err) {
    console.warn('[provisioningStorage] updateBatchTotal failed:', err?.message);
  }
};

// ── Payment status + actual cost ──────────────────────────────────────────────

/**
 * Update payment_status (and optionally actual_unit_cost) on a provisioning item.
 * Silently succeeds even if the column doesn't exist yet.
 */
export const updateItemPaymentStatus = async (itemId, paymentStatus, actualUnitCost) => {
  try {
    const updates = { payment_status: paymentStatus };
    if (actualUnitCost != null) updates.actual_unit_cost = actualUnitCost;
    const { error } = await supabase
      ?.from('provisioning_items')
      ?.update(updates)
      ?.eq('id', itemId);
    if (error) throw error;
  } catch { /* column may not exist yet — non-fatal */ }
};

/**
 * Update a provisioning_deliveries batch record (invoice metadata, file URL, etc.)
 */
export const updateDeliveryBatch = async (batchId, updates) => {
  try {
    const { error } = await supabase
      ?.from('provisioning_deliveries')
      ?.update(updates)
      ?.eq('id', batchId);
    if (error) throw error;
  } catch { /* non-fatal */ }
};

/**
 * Upload an invoice file to Supabase Storage and return the public URL.
 * Bucket: provisioning-invoices (must exist and have public access).
 */
export const uploadInvoiceFile = async (file, batchId) => {
  try {
    const ext = file.name.split('.').pop() || 'pdf';
    const path = `${batchId}/${Date.now()}.${ext}`;
    console.log('[uploadInvoiceFile] uploading', file.name, 'size:', file.size, 'to path:', path);
    const { error } = await supabase?.storage
      ?.from('provisioning-invoices')
      ?.upload(path, file, { upsert: true });
    if (error) {
      console.error('[uploadInvoiceFile] upload error:', error.message, error);
      return null;
    }
    const { data } = await supabase?.storage
      ?.from('provisioning-invoices')
      ?.getPublicUrl(path);
    console.log('[uploadInvoiceFile] public URL:', data?.publicUrl);
    return data?.publicUrl || null;
  } catch (err) {
    console.error('[uploadInvoiceFile] threw:', err);
    return null;
  }
};

// ── Smart Delivery ────────────────────────────────────────────────────────────

// Best-effort lookup: given identifying fields from an upstream context
// (delivery-note OCR, a cross_department_matches row, etc.), find the
// matching supplier_profiles.id. Email match takes priority; name match
// only commits when unambiguous, so we never silently route to the wrong
// supplier. Mirrors the SQL backfill in migration
// 20260523120000_supplier_return_tasks_and_inbox_supplier_link.sql.
// Returns the matched supplier_profiles.id, or null.
export const resolveSupplierProfileId = async ({ name = null, email = null } = {}) => {
  const cleanEmail = (email || '').trim();
  const cleanName  = (name  || '').trim();
  if (!cleanEmail && !cleanName) return null;
  try {
    if (cleanEmail) {
      const { data } = await supabase
        ?.from('supplier_profiles')
        ?.select('id')
        ?.ilike('contact_email', cleanEmail)
        ?.limit(1);
      if (data?.[0]?.id) return data[0].id;
    }
    if (cleanName) {
      // Pull two rows — if both come back, the name is ambiguous and we abstain.
      const { data } = await supabase
        ?.from('supplier_profiles')
        ?.select('id')
        ?.ilike('name', cleanName)
        ?.limit(2);
      if (data?.length === 1) return data[0].id;
    }
  } catch (err) {
    console.error('[resolveSupplierProfileId]', err);
  }
  return null;
};

// Given an array of supplier_profiles.id, return a Map keyed by supplier_id
// of those that have at least one active supplier_contacts row with a
// non-null user_id (i.e. a real linked Cargo portal account). The map's
// value is the canonical supplier_profiles.name — used by the Returns
// view for the routing-button label and the portal-route note so the UI
// always shows the true supplier name rather than the OCR'd snapshot
// (supplier_name on delivery_inbox) which can differ.
//
// Goes through the get_portal_enabled_suppliers SECURITY DEFINER RPC
// because the only SELECT policy on supplier_contacts is supplier-only
// (supplier_read_team_contacts gated on get_user_supplier_id()) — a
// direct table query as a crew caller returns an empty array with no
// error, which is the bug that escaped Part 2's "build green" check.
// The RPC bypasses RLS but returns ONLY the (id, name) pairs for the
// ids the caller asked about; no row contents leak.
//
// Callers: portalEnabledSuppliers.has(id) for the routing decision;
// portalEnabledSuppliers.get(id) for the canonical name.
export const fetchPortalEnabledSuppliers = async (supplierProfileIds = []) => {
  const ids = [...new Set((supplierProfileIds || []).filter(Boolean))];
  if (ids.length === 0) return new Map();
  try {
    const { data, error } = await supabase
      ?.rpc('get_portal_enabled_suppliers', { p_supplier_ids: ids });
    if (error) throw error;
    const map = new Map();
    (data || []).forEach(r => {
      if (r.supplier_id && r.supplier_name) map.set(r.supplier_id, r.supplier_name);
    });
    return map;
  } catch (err) {
    console.error('[fetchPortalEnabledSuppliers]', err);
    return new Map();
  }
};

// Atomically route a return to the supplier's Cargo portal — single RPC
// call wrapping (a) FOR UPDATE lock on the originating inbox rows,
// (b) double-submit guard, (c) INSERT supplier_return_tasks with the
// slip metadata snapshot, (d) UPDATE delivery_inbox rows to archived/
// routed_to_portal. The whole thing runs in one Postgres transaction
// so no partial state is possible.
//
// slipMetadata snapshots the signed-slip context (vessel name + IMO +
// flag, signer name + job title, slip date, vessel signature data URL)
// so the supplier portal can render an audit-equivalent view to what
// an email recipient would see. Frozen at creation — see the
// 20260526120000 migration's comments for the why.
//
// orderId is optional — when the crew picks an order in the Cargo
// confirm dialog on the slip page, it flows through here and lands on
// the new supplier_return_tasks.order_id column (added in migration
// 20260527120000). NULL when no order was picked; common and valid.
//
// Returns { ok: true, taskId } on success, { ok: false } on any failure.
export const sendReturnToPortal = async ({ supplierProfileId, tenantId, inboxIds, items, createdBy, slipMetadata, orderId = null }) => {
  try {
    const { data, error } = await supabase?.rpc('route_return_to_portal', {
      p_supplier_id:   supplierProfileId,
      p_tenant_id:     tenantId,
      p_inbox_ids:     inboxIds,
      p_items:         items,
      p_created_by:    createdBy,
      p_slip_metadata: slipMetadata,
      p_order_id:      orderId,
    });
    if (error) throw error;
    // Fire-and-forget notification email. The supplier_return_tasks row
    // is the source of truth — a failed email must NOT roll back or
    // surface as a routing failure. We deliberately do NOT await the
    // invoke and we swallow any error/rejection into a console.error.
    // The edge function itself returns success-with-noop when there's
    // nobody to email; only logs surface real failures.
    try {
      const notifyPromise = supabase?.functions?.invoke('sendReturnTaskNotification', {
        body: { taskId: data },
      });
      Promise.resolve(notifyPromise).then((res) => {
        if (res?.error) console.error('[sendReturnToPortal] notification email failed:', res.error);
      }).catch((notifyErr) => {
        console.error('[sendReturnToPortal] notification email threw:', notifyErr);
      });
    } catch (notifyErr) {
      console.error('[sendReturnToPortal] notification invoke threw synchronously:', notifyErr);
    }
    return { ok: true, taskId: data };
  } catch (err) {
    console.error('[sendReturnToPortal]', err);
    return { ok: false };
  }
};

// Picker data for the slip page's Cargo confirm dialog. Returns the
// supplier's recent supplier_orders rows in this tenant with a joined
// item count. Crew-side RLS ("tenant members can manage supplier_orders")
// gates the read; the two .eq filters narrow it to the supplier whose
// return we're routing. Returns [] on error or empty result.
export const fetchSupplierOrdersForPicker = async (supplierProfileId, tenantId, { limit = 50 } = {}) => {
  if (!supplierProfileId || !tenantId) return [];
  try {
    const { data, error } = await supabase
      ?.from('supplier_orders')
      ?.select('id, delivery_date, delivery_port, status, created_at, supplier_order_items(count)')
      ?.eq('supplier_profile_id', supplierProfileId)
      ?.eq('tenant_id', tenantId)
      ?.order('created_at', { ascending: false })
      ?.limit(limit);
    if (error) throw error;
    return (data || []).map(o => ({
      id:            o.id,
      delivery_date: o.delivery_date || null,
      delivery_port: o.delivery_port || null,
      status:        o.status,
      created_at:    o.created_at,
      // PostgREST nests the count inside the joined array as [{ count: N }].
      item_count:    o.supplier_order_items?.[0]?.count ?? 0,
    }));
  } catch (err) {
    console.error('[fetchSupplierOrdersForPicker]', err);
    return [];
  }
};

/**
 * Tier 2 cross-department matching — client-side implementation.
 * For each unmatched item from a delivery note scan:
 *   1. Search all OTHER boards in the tenant for open items with a matching name
 *   2. Insert a cross_department_match row for any match found
 *   3. Insert unmatched items into delivery_inbox
 * Returns { crossMatched, inboxed }.
 */
export const triggerCrossDepartmentMatch = async ({ unmatchedItems, tenantId, scannedBy, scannerBoardIds, deliveryBatchId = null, supplierName = null, supplierPhone = null, supplierEmail = null, supplierAddress = null, orderRef = null, orderDate = null, deliveryNoteUrl = null, deliveryNoteRef = null }) => {
  if (!tenantId || !unmatchedItems?.length) return { crossMatched: 0, inboxed: 0 };
  try {
    console.log('========== TIER 2 DEBUG START ==========');
    console.log('[Tier2] Tenant ID:', tenantId);
    console.log('[Tier2] Scanner board IDs:', scannerBoardIds);
    console.log('[Tier2] Items to match:', unmatchedItems.map(i => i.raw_name));

    // Fetch all boards in this tenant except the scanner's own board(s)
    let boardQuery = supabase
      ?.from('provisioning_lists')
      ?.select('id, title, created_by')
      ?.eq('tenant_id', tenantId)
      ?.eq('is_template', false)
      ?.neq('status', 'completed');
    if (scannerBoardIds?.length) {
      boardQuery = boardQuery?.not('id', 'in', `(${scannerBoardIds.join(',')})`);
    }
    const { data: otherBoards, error: boardsError } = await boardQuery;
    console.log('[Tier2] Boards query error:', boardsError);
    console.log('[Tier2] Other boards found:', otherBoards?.length || 0);
    console.log('[Tier2] Other boards:', otherBoards?.map(b => ({ id: b.id, title: b.title })));

    const matchedRawNames = new Set();
    let crossMatched = 0;
    let inboxed = 0;
    const now = new Date().toISOString();

    for (const board of otherBoards || []) {
      // Only open items that haven't already been received
      const { data: boardItems, error: itemsError } = await supabase
        ?.from('provisioning_items')
        ?.select('id, name, status, receive_batch_id, quantity_ordered, quantity_received')
        ?.eq('list_id', board.id)
        ?.in('status', ['draft', 'pending', 'to_order', 'ordered'])
        ?.is('receive_batch_id', null);

      console.log(`[Tier2] Board "${board.title}" (${board.id}):`);
      console.log(`[Tier2]   - Query error:`, itemsError);
      console.log(`[Tier2]   - Items found:`, boardItems?.length || 0);
      console.log(`[Tier2]   - Item names:`, boardItems?.map(i => `${i.name} (${i.status})`));

      for (const extracted of unmatchedItems) {
        if (matchedRawNames.has(extracted.raw_name)) continue; // already matched earlier
        const extLower = (extracted.raw_name || '').toLowerCase().trim();

        for (const boardItem of boardItems || []) {
          const boardLower = (boardItem.name || '').toLowerCase().trim();
          if (!extLower || !boardLower) continue;

          const containsMatch = extLower.includes(boardLower) || boardLower.includes(extLower);
          console.log(`[Tier2]   - Comparing "${extLower}" vs "${boardLower}" = ${containsMatch}`);

          if (containsMatch) {
            const confidence = extLower === boardLower ? 'high' : 'medium';
            console.log(`[Tier2] ✓✓✓ MATCH (${confidence}): "${extracted.raw_name}" → "${boardItem.name}" on "${board.title}"`);

            const targetQtyNeeded = Math.max(0, (boardItem.quantity_ordered || 0) - (boardItem.quantity_received || 0));
            const { error: insertErr } = await supabase?.from('cross_department_matches')?.insert({
              tenant_id: tenantId,
              raw_name: extracted.raw_name,
              item_reference: extracted.item_reference || null,
              quantity: extracted.quantity || 1,
              ordered_qty: extracted.ordered_qty || null,
              unit_price: extracted.unit_price || null,
              line_total: extracted.line_total || null,
              unit: extracted.unit || null,
              scanned_by: scannedBy,
              scanned_at: now,
              matched_board_id: board.id,
              matched_item_id: boardItem.id,
              match_confidence: confidence,
              target_user_id: board.created_by,
              status: 'pending',
              delivery_batch_id: deliveryBatchId,
              supplier_name: supplierName,
              supplier_phone: supplierPhone || null,
              supplier_email: supplierEmail || null,
              supplier_address: supplierAddress || null,
              order_ref: orderRef || null,
              order_date: orderDate || null,
              target_item_qty_needed: targetQtyNeeded || null,
              delivery_note_url: deliveryNoteUrl || null,
              delivery_note_ref: deliveryNoteRef || null,
            });

            if (!insertErr) {
              matchedRawNames.add(extracted.raw_name);
              crossMatched++;
              // Notify the board owner immediately
              const boardOwnerId = board.created_by;
              console.log('[Tier2] Board owner ID:', boardOwnerId);
              if (boardOwnerId) {
                sendNotification([boardOwnerId], {
                  type: NOTIFICATION_TYPES.DELIVERY_CROSS_MATCH,
                  title: 'Delivery items for your board',
                  message: `${extracted.quantity || 1}× ${extracted.raw_name} from a delivery matches your "${board.title}" board`,
                  severity: SEVERITY.INFO,
                  actionUrl: `/provisioning/${board.id}`,
                });
                console.log('[Tier2] Notification sent to board owner:', boardOwnerId);
              }
            } else {
              console.error('[Tier2] insert cross_department_matches error:', insertErr);
            }
            break; // one board match per extracted item
          }
        }
      }
    }

    // Items with no match on any board → Delivery Inbox
    const unmatched = unmatchedItems.filter(i => !matchedRawNames.has(i.raw_name));
    console.log('[Tier2] Unmatched items going to inbox:', unmatched.map(i => i.raw_name));
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    // Resolve once per batch — every unmatched item shares the same supplier.
    const resolvedSupplierProfileId = unmatched.length > 0
      ? await resolveSupplierProfileId({ name: supplierName, email: supplierEmail })
      : null;
    for (const item of unmatched) {
      console.log('[Inbox Insert] Data:', {
        raw_name: item.raw_name,
        item_reference: item.item_reference,
        quantity: item.quantity,
        ordered_qty: item.ordered_qty,
        unit_price: item.unit_price,
        line_total: item.line_total,
        supplier_name: supplierName,
        supplier_phone: supplierPhone,
        supplier_email: supplierEmail,
        supplier_address: supplierAddress,
        order_ref: orderRef,
        order_date: orderDate,
        delivery_note_url: deliveryNoteUrl,
        delivery_note_ref: deliveryNoteRef,
      });
      const { error: inboxErr } = await supabase?.from('delivery_inbox')?.insert({
        tenant_id: tenantId,
        raw_name: item.raw_name,
        item_reference: item.item_reference || null,
        quantity: item.quantity || 1,
        ordered_qty: item.ordered_qty || null,
        unit_price: item.unit_price || null,
        unit: item.unit || null,
        line_total: item.line_total || null,
        scanned_by: scannedBy,
        scanned_at: now,
        delivery_batch_id: deliveryBatchId,
        supplier_name: supplierName,
        supplier_phone: supplierPhone || null,
        supplier_email: supplierEmail || null,
        supplier_address: supplierAddress || null,
        supplier_profile_id: resolvedSupplierProfileId,
        order_ref: orderRef || null,
        order_date: orderDate || null,
        delivery_note_url: deliveryNoteUrl || null,
        delivery_note_ref: deliveryNoteRef || null,
        status: 'pending',
        expires_at: expiresAt,
      });
      if (!inboxErr) inboxed++;
      else console.error('[Tier2] insert delivery_inbox error:', inboxErr);
    }

    console.log(`[Tier2] Done — crossMatched: ${crossMatched}, inboxed: ${inboxed}`);
    console.log('========== TIER 2 DEBUG END ==========');
    return { crossMatched, inboxed };
  } catch (err) {
    console.error('[triggerCrossDepartmentMatch]', err);
    return { crossMatched: 0, inboxed: 0 };
  }
};

export const fetchUserNames = async (userIds) => {
  // Returns { [userId]: 'Full Name' } map
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return {};
  try {
    const { data } = await supabase?.from('profiles')?.select('id, full_name')?.in('id', ids);
    const map = {};
    (data || []).forEach(p => { map[p.id] = p.full_name || null; });
    return map;
  } catch { return {}; }
};

export const fetchCrossDeptMatchesForBoard = async (boardId) => {
  try {
    const { data, error } = await supabase
      ?.from('cross_department_matches')
      ?.select('id, raw_name, quantity, confirmed_qty, status, scanned_by, scanned_at, confirmed_at, match_confidence, target_user_id, tenant_id')
      ?.eq('matched_board_id', boardId)
      ?.in('status', ['confirmed', 'pending'])
      ?.order('confirmed_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) { console.error('[fetchCrossDeptMatchesForBoard]', err); return []; }
};

export const fetchPendingCrossMatches = async (userId) => {
  try {
    const { data, error } = await supabase
      ?.from('cross_department_matches')
      ?.select('*, matched_board:provisioning_lists(id, title, department), matched_item:provisioning_items(id, name, brand, size, unit, status, receive_batch_id, quantity_ordered, quantity_received)')
      ?.eq('target_user_id', userId)
      ?.eq('status', 'pending')
      ?.order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) { console.error('[fetchPendingCrossMatches]', err); return []; }
};

export const confirmCrossMatch = async (matchId, confirmedQty) => {
  try {
    const { data, error } = await supabase
      ?.from('cross_department_matches')
      ?.update({ status: 'confirmed', confirmed_qty: confirmedQty, confirmed_at: new Date().toISOString() })
      ?.eq('id', matchId)?.select()?.single();
    if (error) throw error;
    return data;
  } catch (err) { console.error('[confirmCrossMatch]', err); return null; }
};

export const dismissCrossMatch = async (matchId) => {
  try {
    const { data: match } = await supabase?.from('cross_department_matches')?.select('*')?.eq('id', matchId)?.single();
    await supabase?.from('cross_department_matches')?.update({ status: 'dismissed' })?.eq('id', matchId);
    if (match) {
      const resolvedSupplierProfileId = await resolveSupplierProfileId({
        name: match.supplier_name,
        email: match.supplier_email,
      });
      await supabase?.from('delivery_inbox')?.insert({
        tenant_id: match.tenant_id,
        raw_name: match.raw_name,
        item_reference: match.item_reference || null,
        quantity: match.quantity,
        ordered_qty: match.ordered_qty || null,
        unit_price: match.unit_price || null,
        line_total: match.line_total || null,
        unit: match.unit || null,
        supplier_name: match.supplier_name || null,
        supplier_phone: match.supplier_phone || null,
        supplier_email: match.supplier_email || null,
        supplier_address: match.supplier_address || null,
        supplier_profile_id: resolvedSupplierProfileId,
        order_ref: match.order_ref || null,
        order_date: match.order_date || null,
        delivery_note_url: match.delivery_note_url || null,
        delivery_note_ref: match.delivery_note_ref || null,
        delivery_batch_id: match.delivery_batch_id || null,
        scanned_by: match.scanned_by,
        scanned_at: match.scanned_at || new Date().toISOString(),
        status: 'pending',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
      // Notify all tenant users that an item landed in the inbox
      try {
        const { data: profiles } = await supabase?.from('profiles')?.select('id')?.eq('tenant_id', match.tenant_id);
        const userIds = (profiles || []).map(p => p.id).filter(Boolean);
        if (userIds.length > 0) {
          sendNotification(userIds, {
            type: NOTIFICATION_TYPES.DELIVERY_INBOX_ITEM,
            title: 'Item moved to Delivery Inbox',
            message: `"${match.raw_name}" was dismissed and moved to the Delivery Inbox`,
            severity: SEVERITY.INFO,
            actionUrl: '/provisioning/inbox',
          });
        }
      } catch { /* non-fatal */ }
    }
    return true;
  } catch (err) { console.error('[dismissCrossMatch]', err); return false; }
};

export const archiveExpiredInboxItems = async (tenantId) => {
  if (!tenantId) return;
  try {
    const now = new Date().toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    // Archive items where expires_at has passed
    await supabase?.from('delivery_inbox')?.update({ status: 'archived', archive_reason: 'expired' })
      ?.eq('tenant_id', tenantId)?.eq('status', 'pending')?.lt('expires_at', now);
    // Archive items with no expires_at older than 7 days
    await supabase?.from('delivery_inbox')?.update({ status: 'archived', archive_reason: 'expired' })
      ?.eq('tenant_id', tenantId)?.eq('status', 'pending')?.is('expires_at', null)?.lt('scanned_at', sevenDaysAgo);
  } catch { /* non-fatal */ }
};

export const fetchDeliveryInbox = async (tenantId, includeArchived = false, currentUserId = null) => {
  if (!tenantId) return [];
  await archiveExpiredInboxItems(tenantId);
  // Errors are NOT swallowed — re-thrown so the page can render a real
  // error state. The previous `catch { return []; }` made a failed query
  // indistinguishable from "all clear". The page wraps load() in try/catch
  // and surfaces the error.
  let query = supabase?.from('delivery_inbox')?.select('*')?.eq('tenant_id', tenantId);
  query = includeArchived
    ? query?.in('status', ['pending', 'archived'])
    : query?.eq('status', 'pending');
  const { data, error } = await query?.order('scanned_at', { ascending: false });
  if (error) {
    console.error('[fetchDeliveryInbox]', error);
    throw error;
  }
  const rows = data || [];
  // Per-user dismissals stay filtered client-side.
  if (currentUserId) {
    return rows.filter(item => !(item.dismissed_by || []).includes(currentUserId));
  }
  return rows;
};

/** Mark delivery_inbox item as "not my order" for this user — stays visible to others. */
export const dismissInboxItem = async (itemId, userId) => {
  try {
    // Fetch current dismissed_by array then append (array-append not natively supported in PostgREST)
    const { data: item, error: fetchErr } = await supabase
      ?.from('delivery_inbox')?.select('dismissed_by')?.eq('id', itemId)?.single();
    if (fetchErr) throw fetchErr;
    const existing = item?.dismissed_by || [];
    if (existing.includes(userId)) return true; // already dismissed
    const { error: updateErr } = await supabase?.from('delivery_inbox')
      ?.update({ dismissed_by: [...existing, userId] })?.eq('id', itemId);
    if (updateErr) throw updateErr;
    return true;
  } catch (err) { console.error('[dismissInboxItem]', err); return false; }
};

/** Mark delivery_inbox item as "returned to supplier" — moves to pending_return queue. */
export const returnInboxItem = async (itemId, requestedBy = null) => {
  try {
    const { error } = await supabase?.from('delivery_inbox')
      ?.update({
        status: 'pending_return',
        archive_reason: 'returned',
        return_requested_by: requestedBy,
        return_requested_at: new Date().toISOString(),
      })?.eq('id', itemId);
    if (error) throw error;
    return true;
  } catch (err) { console.error('[returnInboxItem]', err); return false; }
};

/** Fetch items queued for supplier return. Pass includeArchived=true to also show archived returns.
    Re-throws on Supabase error so the page can show a real error state. */
export const fetchPendingReturns = async (tenantId, includeArchived = false) => {
  if (!tenantId) return [];
  let query = supabase?.from('delivery_inbox')?.select('*')?.eq('tenant_id', tenantId);
  if (includeArchived) {
    query = query?.or('status.eq.pending_return,and(status.eq.archived,archive_reason.eq.returned)');
  } else {
    query = query?.eq('status', 'pending_return');
  }
  const { data, error } = await query?.order('supplier_name', { ascending: true });
  if (error) {
    console.error('[fetchPendingReturns]', error);
    throw error;
  }
  return data || [];
};

/** Confirm items have been physically returned — archives them. */
export const confirmReturned = async (itemIds, confirmedBy = null) => {
  if (!itemIds?.length) return false;
  try {
    const { error } = await supabase?.from('delivery_inbox')
      ?.update({
        status: 'archived',
        archive_reason: 'returned',
        return_confirmed_by: confirmedBy,
        return_confirmed_at: new Date().toISOString(),
      })?.in('id', itemIds);
    if (error) throw error;
    return true;
  } catch (err) { console.error('[confirmReturned]', err); return false; }
};

/** Move items from pending_return back to inbox. */
export const cancelReturns = async (itemIds) => {
  if (!itemIds?.length) return false;
  try {
    const { error } = await supabase?.from('delivery_inbox')
      ?.update({ status: 'pending', archive_reason: null, return_requested_by: null, return_requested_at: null })
      ?.in('id', itemIds);
    if (error) throw error;
    return true;
  } catch (err) { console.error('[cancelReturns]', err); return false; }
};

export const claimInboxItem = async (inboxItemId, claimedBy, boardId, claimQty = null) => {
  try {
    // 1. Fetch the inbox item
    const { data: inboxItem, error: fetchErr } = await supabase
      ?.from('delivery_inbox')?.select('*')?.eq('id', inboxItemId)?.single();
    if (fetchErr || !inboxItem) throw fetchErr || new Error('Inbox item not found');

    const totalQty = inboxItem.quantity || 1;
    const qty = claimQty !== null ? Math.min(Math.max(1, claimQty), totalQty) : totalQty;
    const remainder = totalQty - qty;
    const isPartial = remainder > 0;

    // 2. Mark as claimed (or reduce qty for partial claim)
    if (isPartial) {
      // Keep item in inbox with reduced quantity for others to claim
      const { error: updateErr } = await supabase?.from('delivery_inbox')
        ?.update({ quantity: remainder })
        ?.eq('id', inboxItemId);
      if (updateErr) throw updateErr;
    } else {
      const { error: updateErr } = await supabase?.from('delivery_inbox')
        ?.update({ status: 'claimed', claimed_by: claimedBy, claimed_at: new Date().toISOString(), claimed_board_id: boardId })
        ?.eq('id', inboxItemId);
      if (updateErr) throw updateErr;
    }

    // 3. Find matching item on the board (case-insensitive name match)
    const { data: boardItems } = await supabase
      ?.from('provisioning_items')?.select('id, name, quantity_ordered, quantity_received, status')
      ?.eq('list_id', boardId);

    const rawLower = (inboxItem.raw_name || '').toLowerCase().trim();
    const match = (boardItems || []).find(bi => {
      const biLower = (bi.name || '').toLowerCase().trim();
      return biLower && (biLower.includes(rawLower) || rawLower.includes(biLower));
    });

    // 4. Fetch invoice_file_url from original delivery scan batch if present
    let inheritedInvoiceUrl = null;
    if (inboxItem.delivery_batch_id) {
      const { data: origBatch } = await supabase
        ?.from('provisioning_deliveries')
        ?.select('invoice_file_url')
        ?.eq('id', inboxItem.delivery_batch_id)
        ?.maybeSingle();
      inheritedInvoiceUrl = origBatch?.invoice_file_url || null;
    }

    // 5. Create delivery batch for audit trail (carrying through any original document)
    const batch = await createDeliveryBatch({
      listId: boardId,
      tenantId: inboxItem.tenant_id,
      userId: claimedBy,
      supplierName: inboxItem.supplier_name || 'Delivery Inbox claim',
      invoiceFileUrl: inheritedInvoiceUrl,
    });

    if (match) {
      // Update existing item as received
      await supabase?.from('provisioning_items')?.update({
        quantity_received: qty,
        status: 'received',
        receive_batch_id: batch?.id || null,
      })?.eq('id', match.id);
    } else {
      // Create new received item on the board
      await supabase?.from('provisioning_items')?.insert({
        list_id: boardId,
        name: inboxItem.raw_name,
        quantity_ordered: qty,
        quantity_received: qty,
        unit: inboxItem.unit || 'each',
        estimated_unit_cost: inboxItem.unit_price || null,
        status: 'received',
        source: 'delivery_inbox',
        receive_batch_id: batch?.id || null,
      });
    }

    return { ...inboxItem, _claimedQty: qty, _remainder: remainder, _partial: isPartial };
  } catch (err) { console.error('[claimInboxItem]', err); return null; }
};

export const getSmartDeliveryCounts = async (userId, tenantId) => {
  try {
    const [crossRes, inboxRes] = await Promise.all([
      supabase?.from('cross_department_matches')?.select('id', { count: 'exact', head: true })?.eq('target_user_id', userId)?.eq('status', 'pending'),
      supabase?.from('delivery_inbox')?.select('id', { count: 'exact', head: true })?.eq('tenant_id', tenantId)?.eq('status', 'pending'),
    ]);
    return { pendingMatches: crossRes?.count || 0, inboxItems: inboxRes?.count || 0 };
  } catch (err) { return { pendingMatches: 0, inboxItems: 0 }; }
};

/** Write a permanent delivery/receipt record to the vessel-wide delivery ledger. */
export const createLedgerEntry = async ({
  tenantId, sourceType, sourceBoardId, sourceBatchId,
  supplierName, supplierPhone, supplierEmail, supplierAddress,
  orderRef, orderDate, invoiceNumber, deliveryNoteRef, documentUrl,
  documentType, totalAmount, currency, receivedBy, items,
}) => {
  console.log('[createLedgerEntry] Writing to ledger:', { tenantId, sourceType, items: items?.length });
  if (!tenantId) { console.warn('[createLedgerEntry] Aborted — no tenantId'); return null; }
  try {
    // Calculate total from items if not explicitly provided
    const calculatedTotal = totalAmount || items?.reduce((sum, item) => {
      const lt = item.line_total || (item.unit_price && item.quantity ? parseFloat(item.unit_price) * parseFloat(item.quantity) : 0);
      return sum + (lt || 0);
    }, 0) || null;

    const { data: ledger, error: ledgerErr } = await supabase
      ?.from('delivery_ledger')
      ?.insert({
        tenant_id:        tenantId,
        source_type:      sourceType || 'delivery',
        source_board_id:  sourceBoardId  || null,
        source_batch_id:  sourceBatchId  || null,
        supplier_name:    supplierName   || null,
        supplier_phone:   supplierPhone  || null,
        supplier_email:   supplierEmail  || null,
        supplier_address: supplierAddress || null,
        order_ref:        orderRef        || null,
        order_date:       orderDate       || null,
        invoice_number:   invoiceNumber   || null,
        delivery_note_ref: deliveryNoteRef || null,
        document_url:     documentUrl     || null,
        document_type:    documentType    || null,
        total_amount:     calculatedTotal  || null,
        currency:         currency        || null,
        received_by:      receivedBy      || null,
      })
      ?.select()
      ?.single();

    if (ledgerErr) throw ledgerErr;

    if (items?.length && ledger?.id) {
      const rows = items.map(item => ({
        ledger_id:        ledger.id,
        name:             item.raw_name || item.name || 'Unknown item',
        original_name:    item.original_name   || null,
        item_reference:   item.item_reference  || null,
        quantity:         item.quantity         ?? 1,
        ordered_qty:      item.ordered_qty      || null,
        unit:             item.unit             || null,
        unit_price:       item.unit_price       || null,
        total_price:      item.line_total       || null,
        claimed_board_id: item.claimed_board_id || null,
        claimed_item_id:  item.claimed_item_id  || null,
        claim_status:     item.claimed_board_id ? 'claimed' : 'unclaimed',
        match_confidence: item.match_confidence || 'none',
      }));
      const { error: itemsErr } = await supabase?.from('delivery_ledger_items')?.insert(rows);
      if (itemsErr) throw itemsErr;
    }

    console.log('[createLedgerEntry] Success — ledger id:', ledger?.id);
    return ledger;
  } catch (err) {
    console.error('[createLedgerEntry] FAILED:', err);
    throw err;
  }
};

// ── Order history for AI suggestions ─────────────────────────────────────────

/**
 * Fetch recent delivery ledger entries and build an order history array
 * suitable for passing to the suggestItems Edge Function.
 * Returns: Array<{ tripType, guestCount, items: Array<{ name, qty, unit }> }>
 */
export const fetchOrderHistory = async (tenantId, department, limit = 10) => {
  if (!tenantId) return [];
  try {
    const { data: ledgerEntries, error } = await supabase
      ?.from('delivery_ledger')
      ?.select('id, source_type, source_board_id, total_amount, currency, created_at')
      ?.eq('tenant_id', tenantId)
      ?.order('created_at', { ascending: false })
      ?.limit(limit);

    if (error || !ledgerEntries?.length) return [];

    const trips = (await loadTrips()) || [];
    const history = [];

    for (const entry of ledgerEntries) {
      const { data: ledgerItems } = await supabase
        ?.from('delivery_ledger_items')
        ?.select('name, quantity, unit, unit_price')
        ?.eq('ledger_id', entry.id);

      let tripInfo = null;
      if (entry.source_board_id) {
        const { data: board } = await supabase
          ?.from('provisioning_lists')
          ?.select('trip_id, board_type, department')
          ?.eq('id', entry.source_board_id)
          ?.maybeSingle();

        if (board?.trip_id) {
          const trip = findTripByAnyId(trips, board.trip_id);
          if (trip) {
            tripInfo = {
              tripType:   trip.tripType,
              guestCount: trip.guests?.filter(g => g.isActive)?.length || trip.guests?.length || 0,
              startDate:  trip.startDate,
              endDate:    trip.endDate,
            };
          }
        }
      }

      history.push({
        tripType:   tripInfo?.tripType  || 'Unknown',
        guestCount: tripInfo?.guestCount || 0,
        items: (ledgerItems || []).map(i => ({ name: i.name, qty: i.quantity, unit: i.unit })),
      });
    }

    return history;
  } catch (err) {
    console.error('[fetchOrderHistory]', err);
    return [];
  }
};

// ── Supplier Orders ───────────────────────────────────────────────────────────

export const SUPPLIER_ORDER_STATUS = {
  DRAFT:                'draft',
  SENT:                 'sent',
  CONFIRMED:            'confirmed',
  PARTIALLY_CONFIRMED:  'partially_confirmed',
};

export const createSupplierOrder = async ({
  tenantId, listId, supplierName, supplierEmail, supplierPhone,
  deliveryPort, deliveryDate, deliveryTime, deliveryContact,
  specialInstructions, currency = 'USD', items = [], createdBy,
  sentVia = 'email', vesselName = null, supplierProfileId = null,
}) => {
  // Quick Add — denormalized dept snapshot computed from items being
  // sent. Drives the dept-scoping of get_quick_add_favourites (see
  // 20260604120000_supplier_orders_quick_add.sql). Single source of
  // truth: caller passes items, helper derives the array — no risk
  // of departments drift if the caller forgets.
  const departments = [...new Set(
    (items || [])
      .map(it => (it.department || '').trim())
      .filter(Boolean)
  )];

  // Sprint 9c.3 Phase 8 — persist the FK when the order targets a
  // known supplier_profiles row. Previously omitted, which is why
  // order→supplier-overview navigation was broken for every new
  // order (supplier_profile_id was always null).
  const { data: order, error: orderErr } = await supabase
    .from('supplier_orders')
    .insert({
      tenant_id: tenantId, list_id: listId,
      supplier_name: supplierName, supplier_email: supplierEmail,
      supplier_phone: supplierPhone, delivery_port: deliveryPort,
      delivery_date: deliveryDate || null, delivery_time: deliveryTime || null,
      delivery_contact: deliveryContact, special_instructions: specialInstructions,
      currency, created_by: createdBy, sent_via: sentVia,
      vessel_name: vesselName || null,
      supplier_profile_id: supplierProfileId || null,
      departments,
    })
    .select()
    .single();

  if (orderErr) throw orderErr;

  if (items.length > 0) {
    // Quick Add strict-snapshot: persist the fields a stew actually needs
    // to re-order this specific item later via apply-favourite. Brand /
    // size / category / sub_category / department / allergen_flags +
    // supplier_profile_id all snapshot from provisioning_items at send
    // time. Frozen against subsequent edits to the source row.
    //
    // Naming asymmetry: caller's `estimated_price` already maps from
    // provisioning_items.estimated_unit_cost at the call site (see
    // ProvisioningBoardDetail's items projection). Persisted here into
    // supplier_order_items.estimated_price (added in 20260429100000).
    const rows = items.map(it => ({
      order_id:            order.id,
      item_name:           it.name || it.item_name,
      quantity:            it.quantity ?? it.qty,
      unit:                it.unit || null,
      notes:               it.notes || null,
      brand:               it.brand || null,
      size:                it.size || null,
      category:            it.category || null,
      sub_category:        it.sub_category || null,
      department:          it.department || null,
      allergen_flags:      it.allergen_flags || [],
      // Fall back to the order's supplier when the item carries no
      // explicit FK — covers the Unassigned-bucket case where the
      // client-side back-fill (setItemsSupplierProfile) runs after
      // orderItems was built, so the in-memory item still has null.
      supplier_profile_id: it.supplier_profile_id || supplierProfileId || null,
      estimated_price:     it.estimated_price ?? null,
      estimated_currency:  currency || null,
    }));
    const { error: itemsErr } = await supabase.from('supplier_order_items').insert(rows);
    if (itemsErr) throw itemsErr;
  }

  return order;
};

export const markOrderSent = async (orderId, sentVia = 'email') => {
  const { data, error } = await supabase
    .from('supplier_orders')
    .update({ status: 'sent', sent_at: new Date().toISOString(), sent_via: sentVia })
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw error;
  return data;
};

// ── Quick Add — favourites + apply ───────────────────────────────────────────
// Tier + dept gate runs server-side inside the RPCs (see migration
// 20260604120000_supplier_orders_quick_add.sql). The client just calls them;
// errors thrown by Postgres surface in the catch and feed the toast layer.

export const toggleSupplierOrderFavourite = async (orderId) => {
  const { data, error } = await supabase
    .rpc('toggle_supplier_order_favourite', { p_order_id: orderId });
  if (error) throw error;
  return data;  // updated supplier_orders row
};

export const fetchQuickAddFavourites = async (tenantId) => {
  const { data, error } = await supabase
    .rpc('get_quick_add_favourites', { p_tenant_id: tenantId });
  if (error) throw error;
  return data || [];
};

// Dept-scoped log of past supplier_orders for the Quick Add Past Orders
// tab. Sibling to fetchQuickAddFavourites — same SECURITY DEFINER RPC
// pattern, no is_favourite filter, hard-bounded at 500 rows server-side
// (default 100). See migration 20260605120000_quick_add_past_orders_rpc.sql.
export const fetchPastOrders = async (tenantId, limit = 100) => {
  const { data, error } = await supabase
    .rpc('get_quick_add_past_orders', { p_tenant_id: tenantId, p_limit: limit });
  if (error) throw error;
  return data || [];
};

// Read a supplier_order's items — used by the Quick Add Past Orders tab
// when the user expands a card to cherry-pick individual items.
// Tenant-scoping is handled by the existing supplier_order_items RLS;
// the order_id eq filter naturally scopes to the row the user can see.
// Returns minimal shape for preview-and-checkbox UX, plus the id so the
// caller can build a stable checkbox key.
export const fetchSupplierOrderItems = async (orderId) => {
  const { data, error } = await supabase
    .from('supplier_order_items')
    .select('id, item_name, brand, size, quantity, unit')
    .eq('order_id', orderId)
    .order('item_name');
  if (error) throw error;
  return data || [];
};

// Apply a supplier_order's items onto an existing board. Faithful copy
// from the strict-snapshot columns added in migration 20260604120000:
// brand / size / category / sub_category / department / allergen_flags /
// supplier_profile_id all come across, so the new board row identifies
// the SPECIFIC item, not the generic name. Quantity comes across as-is —
// no guest-count scaling, no de-dupe, no warning (per Quick Add brief).
//
// Works for ANY supplier_order (favourited or not) — used by both the
// Favourites tab's Apply button and the Past Orders tab's "Apply all"
// button. Originally shipped as applyFavouriteOrder; renamed to reflect
// what it actually does.
//
// Naming bridges:
//   supplier_order_items.item_name        → provisioning_items.name
//   supplier_order_items.quantity         → provisioning_items.quantity_ordered
//   supplier_order_items.estimated_price  → provisioning_items.estimated_unit_cost
//   supplier_order_items.estimated_currency → provisioning_items.currency
//
// Options:
//   itemIds — optional array of supplier_order_items.id to apply a
//             subset (Past Orders "Add N selected" path). Omit to
//             apply every line on the order ("Apply all" path).
//
// Returns the saved provisioning_items rows.
export const applyOrderItems = async (orderId, listId, { itemIds = null } = {}) => {
  let query = supabase
    .from('supplier_order_items')
    .select('item_name, quantity, unit, notes, brand, size, category, sub_category, department, allergen_flags, supplier_profile_id, estimated_price, estimated_currency')
    .eq('order_id', orderId);
  if (Array.isArray(itemIds) && itemIds.length > 0) {
    query = query.in('id', itemIds);
  }
  const { data: rows, error: readErr } = await query;
  if (readErr) throw readErr;
  if (!rows || rows.length === 0) return [];

  const newItems = rows.map(it => ({
    list_id:             listId,
    name:                it.item_name,
    quantity_ordered:    it.quantity ?? 1,
    quantity_received:   null,
    unit:                it.unit || null,
    notes:               it.notes || null,
    brand:               it.brand || null,
    size:                it.size || null,
    category:            it.category || null,
    sub_category:        it.sub_category || null,
    department:          it.department || null,
    allergen_flags:      it.allergen_flags || [],
    supplier_profile_id: it.supplier_profile_id || null,
    estimated_unit_cost: it.estimated_price ?? null,
    currency:            it.estimated_currency || null,
    status:              'draft',
    // source: intentionally NOT set. The original CHECK constraint
    // (migration 20260325100000) enumerates manual / guest_preference /
    // low_stock / invoice_pattern / smart_suggestion / location_aware —
    // 'favourite' is not in that set. Column is nullable, so omission
    // is safe; the row's provenance is implicit in the timestamp +
    // batch of items that landed together.
  }));

  return await upsertItems(newItems);
};

// Fetch the activity log for a supplier order from the vessel side.
// Newest events first. Reads supplier_order_activity directly via the
// vessel-side RLS policy added in Sprint 9c.2 Commit 1.5b.
export const fetchSupplierOrderActivity = async (orderId) => {
  const { data, error } = await supabase
    .from('supplier_order_activity')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
};

// Sprint 9c.2 Commit 2 follow-up — fetch a single supplier_profiles row
// for the dedicated SupplierDetailPage at /provisioning/suppliers/:id.
// Returns null on no-match; throws on RLS / network errors.
//
// Sprint 9c.2 Phase 4 — selects notes + contacts + edit-tracking columns.
// Sprint 9c.3 Phase 3 — also selects the vendor-model columns added by
// 20260515120000_supplier_profiles_consolidation. Return contract kept
// as-is (throws / null) — SupplierDetailPage depends on it.
export const fetchSupplierProfileById = async (supplierProfileId) => {
  const { data, error } = await supabase
    .from('supplier_profiles')
    .select(`
      id, name, business_country, business_city, business_state_region,
      business_postal_code, business_address_line1, business_address_line2,
      notes, contacts, notes_updated_at, notes_updated_by,
      invoice_payment_terms_days, default_currency,
      tenant_id, vendor_type, categories, subcategories, primary_category,
      is_favourite, archived_at
    `)
    .eq('id', supplierProfileId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

// Sprint 9c.2 Commit 2 follow-up — list every supplier_order tied to a
// given supplier_profile_id. RLS scopes this to the caller's tenant
// automatically (the supplier_orders policy chain runs through
// tenant_members). Sort newest-first.
export const fetchSupplierOrdersBySupplierProfileId = async (supplierProfileId) => {
  const { data, error } = await supabase
    .from('supplier_orders')
    .select(`
      id, status, created_at, currency, list_id, vessel_name, supplier_profile_id,
      supplier_order_items(id, quantity, agreed_price, quoted_price, estimated_price),
      provisioning_lists:list_id(id, title)
    `)
    .eq('supplier_profile_id', supplierProfileId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
};

// Single-order fetch by id — for the dedicated SupplierOrderPage at
// /provisioning/:boardId/orders/:orderId. Returns null on no-match.
// Joins items, invoices, supplier_profile (same shape as fetchSupplierOrders)
// so the page consumes the same projection.
export const fetchSupplierOrderById = async (orderId) => {
  const { data, error } = await supabase
    .from('supplier_orders')
    .select(`
      *,
      supplier_order_items(*),
      supplier_invoices(id, invoice_number, amount, currency, status, pdf_url, created_at, due_date),
      supplier_profile:supplier_profile_id(id, name, business_country, business_city)
    `)
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

export const fetchSupplierOrders = async (listId) => {
  const { data, error } = await supabase
    .from('supplier_orders')
    .select(`
      *,
      supplier_order_items(*),
      supplier_invoices(id, invoice_number, amount, currency, status, pdf_url, created_at, due_date),
      supplier_profile:supplier_profile_id(id, name, business_country, business_city)
    `)
    .eq('list_id', listId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
};

// Mint a 10-min signed URL for a supplier invoice PDF via the
// getInvoiceSignedUrl edge function. The function auth-checks the caller
// against tenant_members for the order's tenant, so no extra client
// permission work is needed here.
export const fetchInvoiceSignedUrl = async (invoiceId) => {
  const { data, error } = await supabase.functions.invoke('getInvoiceSignedUrl', {
    body: { invoiceId },
  });
  if (error) throw error;
  return data; // { signed_url, expires_at }
};

// Generalised signed-URL helper for supplier documents (Sprint 9b). Used by
// the vessel side to open the order PDF, unsigned delivery note, and signed
// delivery note. documentKind values match the edge function contract.
export const fetchDocumentSignedUrl = async (documentKind, documentId) => {
  const { data, error } = await supabase.functions.invoke('getDocumentSignedUrl', {
    body: { documentKind, documentId },
  });
  if (error) throw error;
  return data; // { signed_url, expires_at }
};

// Sprint 9c.2 Commit 2 — vessel-side resend of the delivery-note signing
// link. Mirrors the supplier-portal helper but lives here so the
// SupplierOrderPage can import without crossing module boundaries. The edge
// function enforces a 30-min idempotency window unless force=true.
export const sendDeliveryNoteEmails = async (orderId, { force = false } = {}) => {
  const { data, error } = await supabase.functions.invoke('sendDeliveryNoteEmails', {
    body: { orderId, force },
  });
  if (error) throw error;
  return data;
};

// Sprint 9c.2 Commit 2 — flip an invoice to paid. Updates the invoice row
// status + paid_at, and bumps the parent order to lifecycle 'paid'. The
// invoice row's RLS policy is tenant-scoped, so this works for any vessel
// member who can read the order. Returns the updated invoice row.
export const markInvoicePaid = async (invoiceId) => {
  const nowIso = new Date().toISOString();
  const { data: invoice, error: invErr } = await supabase
    .from('supplier_invoices')
    .update({ status: 'paid', paid_at: nowIso })
    .eq('id', invoiceId)
    .select('id, order_id, status, paid_at')
    .single();
  if (invErr) throw invErr;
  if (invoice?.order_id) {
    // Best-effort: advance the parent order to 'paid'. RLS may reject if
    // the user lacks tenant_members; we don't fail the whole call on that.
    await supabase
      .from('supplier_orders')
      .update({ status: 'paid' })
      .eq('id', invoice.order_id);
  }
  return invoice;
};

// Sprint 9c.2 Phase 5 — vessel-side editable surfaces on supplier_profiles.
//
// Both helpers write to the four crew-writable columns added by migration
// 20260514100000. Authorization runs at two layers:
//   - GRANT UPDATE (notes, contacts, notes_updated_at, notes_updated_by)
//     restricts the column subset
//   - RLS policy crew_update_supplier_notes restricts row eligibility to
//     active tenant_members
// Both functions return { data, error } rather than throwing, so callers
// can render inline error states without try/catch boilerplate.

// Update the notes text. Stamps notes_updated_at + notes_updated_by so the
// "Last edited by X · time ago" footer can reflect provenance.
export const updateSupplierNotes = async (supplierProfileId, notes) => {
  const { data: { user } = {} } = await supabase.auth.getUser();
  const userId = user?.id || null;
  const { data, error } = await supabase
    .from('supplier_profiles')
    .update({
      notes,
      notes_updated_at: new Date().toISOString(),
      notes_updated_by: userId,
    })
    .eq('id', supplierProfileId)
    .select('id, notes, notes_updated_at, notes_updated_by')
    .single();
  return { data, error };
};

// Replace the entire contacts jsonb array. No partial merge — callers
// pass the full array (with any add/edit/delete already applied).
//
// Note: this helper does NOT stamp contacts_updated_at / contacts_
// updated_by — those columns don't exist. The only edit-tracking columns
// in this migration are notes-scoped (notes_updated_at, notes_updated_by).
// Backlog: if we want symmetric provenance on contacts changes, either
// add contacts_updated_at/by columns, or rename the existing pair to
// supplier_meta_updated_at/by and bump it on both writes.
export const updateSupplierContacts = async (supplierProfileId, contacts) => {
  const { data, error } = await supabase
    .from('supplier_profiles')
    .update({ contacts })
    .eq('id', supplierProfileId)
    .select('id, contacts')
    .single();
  return { data, error };
};

// ════════════════════════════════════════════════════════════
// Sprint 9c.3 — Vendor directory helpers (supplier_profiles)
// ════════════════════════════════════════════════════════════
//
// Naming rationale: these are fetchVendors / createVendor / etc., NOT
// fetchSupplierProfiles. A "vendor" is the broader business-relationship
// model — any supplier / service-provider / contractor / agent / broker.
// The underlying table stays `supplier_profiles` for now; this helper
// layer is the abstraction boundary. When the table is eventually
// renamed (future sprint, once a contracts/services module ships), only
// the SQL strings inside these helpers change — call sites don't move.
//
// The legacy fetchSuppliers / createSupplier / updateSupplier /
// deleteSupplier helpers (provisioning_suppliers) are intentionally NOT
// touched here. Phase 8 (consumer repoint) rewrites them to hit
// supplier_profiles with legacy-shape mapping; until then they keep the
// legacy directory + supplier-picker dropdowns working unchanged.
//
// All return { data, error } and never throw. Explicit column lists,
// no SELECT *. RLS (the crew_* tenant-scoped policies from migration
// 20260515120000) is the security boundary — no tenant_id filter is
// needed in these read queries.

const VENDOR_COLUMNS = `
  id, name, vendor_type, primary_category, categories, subcategories,
  is_favourite, archived_at, tenant_id,
  business_country, business_city, business_address_line1,
  contact_email, contact_phone,
  default_currency, invoice_payment_terms_days,
  created_at, updated_at
`;

// Active (non-archived) vendors for the caller's tenant. RLS-scoped.
export const fetchVendors = async () => {
  const { data, error } = await supabase
    .from('supplier_profiles')
    .select(VENDOR_COLUMNS)
    .is('archived_at', null)
    .order('name', { ascending: true });
  return { data: data || [], error };
};

// Archived (soft-deleted) vendors, for the archive view.
export const fetchArchivedVendors = async () => {
  const { data, error } = await supabase
    .from('supplier_profiles')
    .select(VENDOR_COLUMNS)
    .not('archived_at', 'is', null)
    .order('name', { ascending: true });
  return { data: data || [], error };
};

// Create a vendor. The caller MUST include `tenant_id` in the payload
// (from the page's activeTenantId) — the crew_insert_supplier_profiles
// RLS WITH CHECK requires tenant_id ∈ the caller's active tenant_members,
// so an INSERT without it is rejected. Convention: payload.categories
// should be [primary_category] so the categories[] always carries the
// primary; subcategories go in payload.subcategories.
export const createVendor = async (payload) => {
  const { data, error } = await supabase
    .from('supplier_profiles')
    .insert([payload])
    .select(VENDOR_COLUMNS)
    .single();
  return { data, error };
};

// Patch mutable vendor fields. Stamps updated_at.
export const updateVendor = async (id, patch) => {
  const { data, error } = await supabase
    .from('supplier_profiles')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(VENDOR_COLUMNS)
    .single();
  return { data, error };
};

// Toggle the per-tenant favourite flag (any crew member's toggle
// persists for the whole tenant — favourites are not per-user in v1).
export const toggleVendorFavourite = async (id, value) => {
  const { data, error } = await supabase
    .from('supplier_profiles')
    .update({ is_favourite: !!value })
    .eq('id', id)
    .select('id, is_favourite')
    .single();
  return { data, error };
};

// Soft delete — stamps archived_at. Restorable via restoreVendor.
export const archiveVendor = async (id) => {
  const { data, error } = await supabase
    .from('supplier_profiles')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, archived_at')
    .single();
  return { data, error };
};

// Restore from archive — clears archived_at.
export const restoreVendor = async (id) => {
  const { data, error } = await supabase
    .from('supplier_profiles')
    .update({ archived_at: null })
    .eq('id', id)
    .select('id, archived_at')
    .single();
  return { data, error };
};

// Union of categories + subcategories across the tenant's active
// vendors. Drives the directory's filter chips and the form's picker
// autocomplete. Subcategories have no parent column of their own — the
// only parent signal is the row's primary_category, so a row's
// subcategories are attributed to its primary_category. Returns
// { categories: string[], subcategories: { [parent]: string[] } },
// shaped for vendorConstants.mergeTaxonomy().
export const fetchKnownCategoryTaxonomy = async () => {
  const { data, error } = await supabase
    .from('supplier_profiles')
    .select('primary_category, categories, subcategories')
    .is('archived_at', null);
  if (error) return { data: null, error };

  const categoriesSet = new Set();
  const subByParent = {};
  for (const row of data || []) {
    if (row.primary_category) categoriesSet.add(row.primary_category);
    for (const c of row.categories || []) if (c) categoriesSet.add(c);
    // Defensive: subcategories have no parent column of their own — they
    // hang off the row's primary_category. If primary_category is null
    // (only reachable via a direct Studio edit that bypasses the Phase 6
    // form's required-field validation), the row's subcategories are
    // orphans and are intentionally dropped from the taxonomy rather
    // than mis-attributed. The row's `categories` values still count —
    // they don't need a parent.
    if (!row.primary_category) continue;
    if (Array.isArray(row.subcategories)) {
      if (!subByParent[row.primary_category]) subByParent[row.primary_category] = new Set();
      for (const s of row.subcategories) if (s) subByParent[row.primary_category].add(s);
    }
  }
  const subcategories = {};
  for (const [parent, set] of Object.entries(subByParent)) {
    subcategories[parent] = [...set].sort((a, b) => a.localeCompare(b));
  }
  return {
    data: {
      categories: [...categoriesSet].sort((a, b) => a.localeCompare(b)),
      subcategories,
    },
    error: null,
  };
};

// Sprint 9c.3 Phase 5 — lightweight per-vendor order rollup for the
// directory card metadata row ("N orders · last Xd ago" + total spend).
// One RLS-scoped query over the tenant's supplier_orders (+ nested
// items for the spend sum), aggregated client-side into a map keyed by
// supplier_profile_id. Per-vendor N+1 avoided. Returns { data: map,
// error } where map[supplierProfileId] = { orderCount, lastOrderAt,
// totalSpend, currency }. Vendors with no orders are simply absent from
// the map (the card renders a 0/— fallback).
export const fetchVendorOrderStats = async () => {
  const { data, error } = await supabase
    .from('supplier_orders')
    .select(`
      supplier_profile_id, created_at, currency,
      supplier_order_items(quantity, agreed_price, quoted_price, estimated_price)
    `);
  if (error) return { data: {}, error };
  const map = {};
  for (const o of data || []) {
    const k = o.supplier_profile_id;
    if (!k) continue;
    if (!map[k]) {
      map[k] = { orderCount: 0, lastOrderAt: null, totalSpend: 0, currency: o.currency || 'EUR' };
    }
    map[k].orderCount += 1;
    if (!map[k].lastOrderAt || o.created_at > map[k].lastOrderAt) {
      map[k].lastOrderAt = o.created_at;
    }
    const total = (o.supplier_order_items || []).reduce((s, it) => {
      const unit = Number(it.agreed_price ?? it.quoted_price ?? it.estimated_price) || 0;
      return s + unit * (Number(it.quantity) || 0);
    }, 0);
    map[k].totalSpend += total;
  }
  return { data: map, error: null };
};

// Vessel (tenant) display name for the directory meta strip. Same
// query Header uses; RLS on `tenants` already scopes it to the
// caller's memberships. Returns { data: name|null, error }.
export const fetchTenantName = async (tenantId) => {
  if (!tenantId) return { data: null, error: null };
  const { data, error } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle();
  return { data: data?.name || null, error };
};

export const fetchOrderByToken = async (token) => {
  const { data, error } = await supabase
    .from('supplier_orders')
    .select('*, supplier_order_items(*)')
    .eq('public_token', token)
    .single();
  if (error) throw error;
  return data;
};

export const updateOrderItemStatus = async (itemId, updates) => {
  const { data, error } = await supabase
    .from('supplier_order_items')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', itemId)
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const confirmSupplierOrder = async (orderId, supplierNotes = '') => {
  const { data: items } = await supabase
    .from('supplier_order_items')
    .select('status')
    .eq('order_id', orderId);

  const statuses = (items || []).map(i => i.status);
  const allConfirmed = statuses.every(s => s === 'confirmed');
  const anyConfirmed = statuses.some(s => s === 'confirmed' || s === 'substituted');
  const newStatus = allConfirmed ? 'confirmed'
    : anyConfirmed ? 'partially_confirmed'
    : 'confirmed';

  const { data, error } = await supabase
    .from('supplier_orders')
    .update({ status: newStatus, confirmed_at: new Date().toISOString(), supplier_notes: supplierNotes })
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw error;
  return data;
};

// ─── Quote workflow (Sprint 9.5 — vessel side) ──────────────────────────────
//
// Each helper just calls a SECURITY DEFINER RPC defined in migration
// 20260429100300. The RPCs do their own auth checks against
// tenant_members via the order's provisioning_list, so no client-side
// permission work is needed here.

// Accept the supplier's quoted price on a single line. Server copies
// quoted_price → agreed_price and flips quote_status to 'agreed'.
// Valid from 'quoted' or 'in_discussion'.
export const acceptOrderItemQuote = async (itemId) => {
  const { data, error } = await supabase.rpc('accept_order_item_quote', { p_item_id: itemId });
  if (error) throw error;
  return data;
};

// Decline the supplier's quoted price. Server clears agreed_* and flips
// quote_status to 'declined'. Supplier sees the line return to
// re-quotable state.
export const declineOrderItemQuote = async (itemId) => {
  const { data, error } = await supabase.rpc('decline_order_item_quote', { p_item_id: itemId });
  if (error) throw error;
  return data;
};

// Open a query / discussion thread on a quoted line. Server flips
// quote_status to 'in_discussion'. Threading itself is a future sprint
// — this just marks the line so the supplier knows the vessel has a
// question.
export const queryOrderItemQuote = async (itemId) => {
  const { data, error } = await supabase.rpc('query_order_item_quote', { p_item_id: itemId });
  if (error) throw error;
  return data;
};

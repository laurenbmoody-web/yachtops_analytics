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
 *   discrepancies jsonb, received_by uuid
 */

import { supabase } from '../../../lib/supabaseClient';

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
  PENDING: 'pending',
  RECEIVED: 'received',
  SHORT_DELIVERED: 'short_delivered',
  NOT_DELIVERED: 'not_delivered',
};

export const PROVISION_DEPARTMENTS = ['Galley', 'Interior', 'Deck', 'Engineering', 'Admin'];

export const PROVISION_UNITS = ['each', 'kg', 'litre', 'box', 'bottle', 'case', 'tin', 'bag', 'pack', 'dozen'];

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
 * Fetch active departments for this vessel from vessels.departments_in_use.
 * Returns a string[] of department names, or [] on failure / missing config.
 */
export const fetchVesselDepartments = async (tenantId) => {
  if (!tenantId) return [];
  try {
    const { data, error } = await supabase
      ?.from('vessels')
      ?.select('departments_in_use')
      ?.eq('tenant_id', tenantId)
      ?.limit(1)
      ?.single();
    if (error || !data?.departments_in_use) return [];
    const raw = data.departments_in_use;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (err) {
    console.warn('[provisioningStorage] fetchVesselDepartments error:', err);
    return [];
  }
};

// ── Lists ─────────────────────────────────────────────────────────────────────

export const fetchProvisioningLists = async (vesselId, userId = null, userDeptId = null) => {
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

      // Build OR filter: owner OR (department visibility + same dept) OR collaborator
      const orParts = [`owner_id.eq.${userId}`, `created_by.eq.${userId}`];
      if (userDeptId) {
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
    const { error } = await supabase
      ?.from('provisioning_lists')
      ?.delete()
      ?.eq('id', listId);
    if (error) throw error;
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

export const updateItemStatus = async (itemId, status, quantityReceived) => {
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
    return data;
  } catch (err) {
    console.error('[provisioningStorage] updateItemStatus error:', err);
    throw err;
  }
};

// ── Suppliers ─────────────────────────────────────────────────────────────────

export const fetchSuppliers = async (vesselId) => {
  try {
    const { data, error } = await supabase
      ?.from('provisioning_suppliers')
      ?.select('*')
      ?.eq('tenant_id', vesselId)
      ?.order('name');
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[provisioningStorage] fetchSuppliers error:', err);
    throw err;
  }
};

export const createSupplier = async (supplierData) => {
  try {
    const { data, error } = await supabase
      ?.from('provisioning_suppliers')
      ?.insert([supplierData])
      ?.select()
      ?.single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('[provisioningStorage] createSupplier error:', err);
    throw err;
  }
};

export const updateSupplier = async (supplierId, updates) => {
  try {
    const { data, error } = await supabase
      ?.from('provisioning_suppliers')
      ?.update(updates)
      ?.eq('id', supplierId)
      ?.select()
      ?.single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('[provisioningStorage] updateSupplier error:', err);
    throw err;
  }
};

export const deleteSupplier = async (supplierId) => {
  try {
    const { error } = await supabase
      ?.from('provisioning_suppliers')
      ?.delete()
      ?.eq('id', supplierId);
    if (error) throw error;
  } catch (err) {
    console.error('[provisioningStorage] deleteSupplier error:', err);
    throw err;
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

export const fetchMasterOrderHistory = async (vesselId) => {
  try {
    // Get all delivered lists for this vessel
    const { data: lists, error: listsErr } = await supabase
      ?.from('provisioning_lists')
      ?.select('id, title')
      ?.eq('tenant_id', vesselId)
      ?.eq('status', 'delivered');
    if (listsErr) throw listsErr;
    if (!lists?.length) return [];

    const listIds = lists.map(l => l.id);

    const { data: items, error: itemsErr } = await supabase
      ?.from('provisioning_items')
      ?.select('id, list_id, name, brand, size, category, sub_category, department, quantity_ordered, unit, created_at')
      ?.in('list_id', listIds)
      ?.order('name');
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
  const notDelivered = items.filter(i => i.status === ITEM_STATUS.NOT_DELIVERED);
  const short = items.filter(i => i.status === ITEM_STATUS.SHORT_DELIVERED);
  if (notDelivered.length === items.length) return PROVISIONING_STATUS.PARTIALLY_DELIVERED;
  if (notDelivered.length > 0 || short.length > 0) return PROVISIONING_STATUS.DELIVERED_WITH_DISCREPANCIES;
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
      ?.select('id, user_id, permission, added_at, profiles(full_name, email, avatar_url)')
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
    // 4. Exact name match (case-insensitive)
    if (provItem?.name) {
      const { data } = await supabase
        ?.from('inventory_items')
        ?.select('id, name, brand, size, unit, cargo_item_id, barcode, stock_locations, location, sub_location, total_qty, unit_cost, currency')
        ?.ilike('name', provItem.name)
        ?.eq('tenant_id', tenantId)
        ?.limit(1);
      if (data?.[0]) return data[0];
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
export const createInventoryItemFromProvItem = async ({ provItem, locationName, qty, tenantId, userId }) => {
  if (!tenantId) return null;
  try {
    const stockLocations = locationName
      ? [{ locationName: locationName.trim(), locationId: '', qty: qty || 0 }]
      : [];
    const { data, error } = await supabase
      ?.from('inventory_items')
      ?.insert({
        tenant_id: tenantId,
        created_by: userId || null,
        name: provItem?.name || '',
        brand: provItem?.brand || null,
        size: provItem?.size || null,
        unit: provItem?.unit || 'each',
        location: locationName?.split(' > ')?.[0]?.trim() || locationName || null,
        sub_location: locationName || null,
        stock_locations: stockLocations,
        total_qty: qty || 0,
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

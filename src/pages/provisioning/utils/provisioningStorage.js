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

// ── Lists ─────────────────────────────────────────────────────────────────────

export const fetchProvisioningLists = async (vesselId) => {
  try {
    const { data, error } = await supabase
      ?.from('provisioning_lists')
      ?.select('*')
      ?.eq('tenant_id', vesselId)
      ?.order('sort_order', { ascending: true, nullsFirst: false })
      ?.order('created_at', { ascending: true });
    if (error) throw error;
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

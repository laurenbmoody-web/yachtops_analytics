import { supabase } from '../../../lib/supabaseClient';

// ─── Profile ────────────────────────────────────────────────────────────────

// The supplier's own reputation KPIs — orders filled, on-time %, response
// time — from real order history (get_my_supplier_health RPC). Returns null
// on failure so the Overview can degrade quietly.
export const fetchMySupplierHealth = async () => {
  try {
    const { data, error } = await supabase.rpc('get_my_supplier_health');
    if (error) throw error;
    const r = Array.isArray(data) ? data[0] : data;
    if (!r) return null;
    const elig = Number(r.on_time_eligible) || 0;
    return {
      ordersFilled: Number(r.orders_fulfilled) || 0,
      ordersCount: Number(r.orders_count) || 0,
      onTimePct: elig > 0 ? Math.round((Number(r.on_time_count) || 0) / elig * 100) : null,
      avgResponseHours: r.avg_response_hours != null ? Number(r.avg_response_hours) : null,
      lastOrderAt: r.last_order_at || null,
    };
  } catch (err) {
    console.warn('[supplierStorage] fetchMySupplierHealth (non-blocking):', err?.message);
    return null;
  }
};

// Storefront fields — saved via a SECURITY DEFINER RPC (a direct table
// update is blocked by table privileges on supplier_profiles).
export const updateSupplierStorefront = async (f) => {
  const { error } = await supabase.rpc('update_supplier_storefront', {
    p_lead_time_days:     f.lead_time_days ?? null,
    p_order_cutoff:       f.order_cutoff || null,
    p_min_order_value:    f.min_order_value ?? null,
    p_min_order_currency: f.min_order_currency || 'EUR',
    p_certifications:     f.certifications || [],
    p_express_available:  !!f.express_available,
    p_delivery_days:      f.delivery_days || [],
    p_cutoff_strict:      !!f.cutoff_strict,
    p_contact_name:       f.contact_name || null,
    p_contact_role:       f.contact_role || null,
    p_contact_email:      f.contact_email || null,
    p_contact_phone:      f.contact_phone || null,
  });
  if (error) throw error;
};

// ─── Certifications (with optional documents) ────────────────────────────────
export const fetchMyCertifications = async () => {
  const { data, error } = await supabase.rpc('get_my_certifications');
  if (error) throw error;
  return (data ?? []).map(c => ({ id: c.id, name: c.name, docUrl: c.doc_url || '', verified: !!c.verified, expiryDate: c.expiry_date || null, status: c.status || 'pending' }));
};

// Replace the caller's certification set. certs: [{ name, docUrl }].
export const saveMyCertifications = async (certs) => {
  const { error } = await supabase.rpc('save_my_certifications', {
    p_certs: (certs || []).map(c => ({ name: c.name, doc_url: c.docUrl || null })),
  });
  if (error) throw error;
};

// Kick off the AI first-pass review for a certificate the supplier just
// attached — Claude reads the document and emails the Cargo team the parsed
// details + a link to the issuing body's register. Fire-and-forget: the
// supplier's save must not wait on (or fail because of) the review.
export const requestCertReview = async (supplierId, name) => {
  try {
    await supabase.functions.invoke('review-supplier-cert', { body: { supplierId, name } });
  } catch (e) {
    console.warn('[requestCertReview] could not queue review:', e?.message || e);
  }
};

// Upload a certificate document to the public supplier-certs bucket under the
// supplier's own folder. Returns the public URL.
export const uploadCertDoc = async (supplierId, file) => {
  if (!file) throw new Error('No file provided');
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
  const safe = (file.name.replace(/\.[^.]+$/, '') || 'cert').replace(/[^a-z0-9]+/gi, '-').slice(0, 40).toLowerCase() || 'cert';
  const path = `${supplierId}/${safe}-${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from('supplier-certs')
    .upload(path, file, { upsert: true, cacheControl: '3600' });
  if (uploadError) throw uploadError;
  const { data: { publicUrl } } = supabase.storage.from('supplier-certs').getPublicUrl(path);
  return publicUrl;
};

export const updateSupplierProfile = async (supplierId, updates) => {
  const { data, error } = await supabase
    .from('supplier_profiles')
    .update(updates)
    .eq('id', supplierId)
    .select()
    .single();
  if (error) throw error;
  return data;
};

// ─── Orders ─────────────────────────────────────────────────────────────────

export const fetchSupplierOrders = async (supplierId, { status, limit = 50 } = {}) => {
  let query = supabase
    .from('supplier_orders')
    .select('*, supplier_order_items(*)')
    .eq('supplier_profile_id', supplierId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
};

export const fetchOrderById = async (orderId) => {
  const { data, error } = await supabase
    .from('supplier_orders')
    .select(`
      *,
      supplier_order_items(*),
      assigned_contact:supplier_contacts!assigned_to_supplier_contact_id(id, name, email, role),
      invoices:supplier_invoices(id, invoice_number, pdf_url, amount, currency, status, created_at, due_date)
    `)
    .eq('id', orderId)
    .single();
  if (error) throw error;
  return data;
};

// ─── Order admin (Edit delivery / Reassign) ──────────────────────────────────

// Update editable delivery fields on an order. Whitelisted columns only —
// caller-supplied keys outside this set are silently ignored so this can't
// be used to bypass the (otherwise tightly RLS'd) `supplier_orders` table.
//
// Note: special_instructions is intentionally NOT in this list. That column
// holds the vessel's charter context (cuisine style, allergens, owner-aboard
// dates) and is the vessel's data, not the supplier's delivery notes.
export const updateOrderDelivery = async (orderId, updates) => {
  const allowed = ['delivery_date', 'delivery_time', 'delivery_port', 'delivery_contact'];
  const payload = Object.fromEntries(
    Object.entries(updates).filter(([k]) => allowed.includes(k))
  );
  const { data, error } = await supabase
    .from('supplier_orders')
    .update(payload)
    .eq('id', orderId)
    .select(`
      *,
      assigned_contact:supplier_contacts!assigned_to_supplier_contact_id(id, name, email, role)
    `)
    .single();
  if (error) throw error;
  return data;
};

// Assign an order to a team member. Pass null to unassign.
export const assignOrderToContact = async (orderId, supplierContactId) => {
  const { data, error } = await supabase
    .from('supplier_orders')
    .update({ assigned_to_supplier_contact_id: supplierContactId })
    .eq('id', orderId)
    .select(`
      *,
      assigned_contact:supplier_contacts!assigned_to_supplier_contact_id(id, name, email, role)
    `)
    .single();
  if (error) throw error;
  return data;
};

// List team members for the current supplier (Reassign picker / Settings → Team).
// supplier_contacts RLS scopes reads to the caller's supplier via
// get_user_supplier_id() (see migration 20260427130000), so no explicit
// supplier_id filter is needed here.
//
// `activeOnly` defaults to true — Reassign picker wants only people who
// have accepted. Settings → Team can pass { activeOnly: false } to include
// soft-removed members for audit history.
export const fetchSupplierTeam = async ({ activeOnly = true } = {}) => {
  let query = supabase
    .from('supplier_contacts')
    .select('id, name, email, role, user_id, active, permission_tier')
    .order('name', { ascending: true });
  if (activeOnly) query = query.eq('active', true);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
};

// Fetch the activity log for a supplier order. Newest events first.
export const fetchOrderActivity = async (orderId) => {
  const { data, error } = await supabase
    .from('supplier_order_activity')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
};

// Which timestamp column a status transition stamps. Only genuine
// lifecycle transitions get a stamp; picking/packed are display-only.
// confirmed_at is also set by the confirm-flow trigger — re-stamping on a
// manual confirm here is harmless and keeps the two paths consistent.
const STATUS_STAMP = {
  confirmed:  'confirmed_at',
  dispatched: 'dispatched_at',
  received:   'delivered_at',
  invoiced:   'invoiced_at',
  paid:       'paid_at',
};

export const updateOrderStatus = async (orderId, status) => {
  const patch = { status };
  const stampCol = STATUS_STAMP[status];
  if (stampCol) patch[stampCol] = new Date().toISOString();
  const { data, error } = await supabase
    .from('supplier_orders')
    .update(patch)
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const updateOrderItem = async (itemId, updates) => {
  const { data, error } = await supabase
    .from('supplier_order_items')
    .update(updates)
    .eq('id', itemId)
    .select()
    .single();
  if (error) throw error;
  return data;
};

// Count of supplier_order_items still pending that the vessel revised
// after the supplier originally confirmed / substituted / marked
// unavailable. Drives the bell badge in SupplierLayout — non-zero
// means there are lines that need a re-confirm. Server-scoped to the
// caller's supplier via the RLS policy on supplier_order_items (the
// JOIN to supplier_orders honours supplier_profile_id =
// get_user_supplier_id()).
export const fetchVesselRevisedCount = async () => {
  // Two parallel counts summed into the bell badge:
  //   - supplier_order_items where the vessel reopened the line
  //     (revised_at IS NOT NULL, still pending)
  //   - supplier_orders where the vessel auto-approved the quote
  //     and the supplier hasn't yet ack'd the marker
  //     (vessel_approved_at IS NOT NULL, vessel_approved_seen_at
  //     either NULL or older than the approval)
  const [revisedRes, approvedRes] = await Promise.all([
    supabase
      .from('supplier_order_items')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .not('revised_at', 'is', null),
    supabase
      .from('supplier_orders')
      .select('id', { count: 'exact', head: true })
      .not('vessel_approved_at', 'is', null)
      .is('vessel_approved_seen_at', null),
  ]);
  if (revisedRes.error) {
    console.error('[supplierStorage] fetchVesselRevisedCount revised:', revisedRes.error);
  }
  if (approvedRes.error) {
    console.error('[supplierStorage] fetchVesselRevisedCount approved:', approvedRes.error);
  }
  return (revisedRes.count || 0) + (approvedRes.count || 0);
};

// Detailed list of vessel-revised lines for the bell-icon dropdown.
// Two-step fetch so the list never gets dropped by a stricter RLS on
// the joined supplier_orders row — we pull the items first (same
// scope as the count query), then look up the parent order names in
// a second pass. Missing parent rows are still shown with a fallback
// "Order" label so the user can click through.
export const fetchVesselRevisedLines = async () => {
  const { data: lines, error } = await supabase
    .from('supplier_order_items')
    .select('id, item_name, quantity, unit, revised_at, order_id')
    .eq('status', 'pending')
    .not('revised_at', 'is', null)
    .order('revised_at', { ascending: false })
    .limit(20);
  if (error) {
    console.error('[supplierStorage] fetchVesselRevisedLines failed:', error);
    return [];
  }
  if (!lines || lines.length === 0) return [];

  const orderIds = Array.from(new Set(lines.map((l) => l.order_id).filter(Boolean)));
  let ordersById = {};
  if (orderIds.length > 0) {
    const { data: orders } = await supabase
      .from('supplier_orders')
      .select('id, vessel_name, yacht_name, delivery_date')
      .in('id', orderIds);
    ordersById = Object.fromEntries((orders || []).map((o) => [o.id, o]));
  }
  return lines.map((l) => ({
    ...l,
    parent_order: ordersById[l.order_id] || null,
  }));
};

// Vessel-approved orders the supplier hasn't yet acknowledged. Same
// fall-back-friendly shape as fetchVesselRevisedLines so the bell
// dropdown can interleave both.
export const fetchVesselApprovedOrders = async () => {
  const { data, error } = await supabase
    .from('supplier_orders')
    .select('id, vessel_name, yacht_name, status, vessel_approved_at, delivery_date')
    .not('vessel_approved_at', 'is', null)
    .is('vessel_approved_seen_at', null)
    .order('vessel_approved_at', { ascending: false })
    .limit(10);
  if (error) {
    console.error('[supplierStorage] fetchVesselApprovedOrders failed:', error);
    return [];
  }
  return data || [];
};

// Supplier-side mirror of the vessel reopen flow. When the supplier
// realises a confirmed line needs to change (stock fell through,
// shipment delayed, sub no longer viable) they hit "Request changes"
// instead of editing silently — which the DB-level guard
// (20260617260000) would block anyway. This helper:
//
//   1. Flips status back to 'pending' so every editor on the
//      work-queue layout opens up again.
//   2. Inserts a 'supplier_requested_reopen' activity event with
//      the reason text — the crew board's "Note from supplier"
//      feed picks this up as a high-priority row (red emphasis,
//      pulse) so the chief can prepare alternatives.
//   3. Optionally clears agreed_price / agreed_currency. We keep
//      them — the supplier might land on the same number; if they
//      need to requote, the editable price input takes the new
//      number and the auto-accept trigger handles the rest.
//
// Reason is required so the activity row carries context.
export const supplierRequestLineReopen = async (itemId, reason) => {
  if (!itemId) throw new Error('Missing itemId');
  if (!reason || !reason.trim()) throw new Error('Reason required');

  // 1) Need the order_id + name for the activity row.
  const { data: current, error: fetchErr } = await supabase
    .from('supplier_order_items')
    .select('id, order_id, item_name, status, quote_status')
    .eq('id', itemId)
    .single();
  if (fetchErr) throw fetchErr;
  if (!current) throw new Error('Item not found');

  // 2) Flip the line back to pending. quote_status drops to
  //    'in_discussion' so the line is rendered as "Re-quote needed"
  //    on the work-queue layout but still carries the prior price
  //    as a fallback for the auto-accept trigger.
  const { data: updated, error: updateErr } = await supabase
    .from('supplier_order_items')
    .update({
      status: 'pending',
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)
    .select()
    .single();
  if (updateErr) throw updateErr;

  // 3) Activity event. Sibling to vessel-side 'line_reopened' from
  //    #1141; same audit trail shape, distinct event_type so the
  //    crew chip can colour it differently (red emphasis vs the
  //    vessel-grey reopen marker).
  await supabase
    .from('supplier_order_activity')
    .insert({
      order_id: current.order_id,
      item_id: itemId,
      event_type: 'supplier_requested_reopen',
      payload: {
        item_name: current.item_name,
        previous_status: current.status,
        previous_quote_status: current.quote_status,
        reason: reason.trim(),
      },
    });

  return updated;
};

// Called when the supplier opens an order whose vessel-approved
// marker is still un-ack'd. Idempotent; cheap; fired from the order
// detail page on mount.
export const markVesselApprovedSeen = async (orderId) => {
  if (!orderId) return;
  await supabase
    .from('supplier_orders')
    .update({ vessel_approved_seen_at: new Date().toISOString() })
    .eq('id', orderId)
    .is('vessel_approved_seen_at', null);
};

// ─── Catalogue ───────────────────────────────────────────────────────────────

export const fetchCatalogueItems = async (supplierId) => {
  const { data, error } = await supabase
    .from('supplier_catalogue_items')
    .select('*')
    .eq('supplier_id', supplierId)
    .order('category', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return data ?? [];
};

export const createCatalogueItem = async (supplierId, item) => {
  const { data, error } = await supabase
    .from('supplier_catalogue_items')
    .insert({ ...item, supplier_id: supplierId })
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const updateCatalogueItem = async (itemId, updates) => {
  const { data, error } = await supabase
    .from('supplier_catalogue_items')
    .update(updates)
    .eq('id', itemId)
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const deleteCatalogueItem = async (itemId) => {
  const { error } = await supabase
    .from('supplier_catalogue_items')
    .delete()
    .eq('id', itemId);
  if (error) throw error;
};

/**
 * Bulk insert for the AI price-list import. Inserts in batches so a big
 * catalogue (hundreds of rows) doesn't hit a single-request payload limit.
 * Returns the created rows.
 */
export const bulkCreateCatalogueItems = async (supplierId, items) => {
  const BATCH = 100;
  const created = [];
  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH).map(item => ({ ...item, supplier_id: supplierId }));
    const { data, error } = await supabase
      .from('supplier_catalogue_items')
      .insert(slice)
      .select();
    if (error) throw error;
    created.push(...(data ?? []));
  }
  return created;
};

/** Apply the same patch to many catalogue rows (bulk category change, stock flag…). */
export const bulkUpdateCatalogueItems = async (itemIds, updates) => {
  const { data, error } = await supabase
    .from('supplier_catalogue_items')
    .update(updates)
    .in('id', itemIds)
    .select();
  if (error) throw error;
  return data ?? [];
};

export const bulkDeleteCatalogueItems = async (itemIds) => {
  const { error } = await supabase
    .from('supplier_catalogue_items')
    .delete()
    .in('id', itemIds);
  if (error) throw error;
};

/**
 * Private buy prices (catalogue_item_costs — supplier-only RLS, crew
 * can never read it). Returns { [catalogue_item_id]: cost_price }.
 */
export const fetchCatalogueCosts = async (supplierId) => {
  const { data, error } = await supabase
    .from('catalogue_item_costs')
    .select('catalogue_item_id, cost_price')
    .eq('supplier_id', supplierId);
  if (error) throw error;
  const map = {};
  (data ?? []).forEach(r => { map[r.catalogue_item_id] = r.cost_price; });
  return map;
};

export const upsertCatalogueCost = async (supplierId, itemId, costPrice, currency = 'EUR') => {
  const { error } = await supabase
    .from('catalogue_item_costs')
    .upsert(
      { catalogue_item_id: itemId, supplier_id: supplierId, cost_price: costPrice, currency },
      { onConflict: 'catalogue_item_id' }
    );
  if (error) throw error;
};

/**
 * Committed stock per catalogue item: quantity on this supplier's live
 * orders (sent / confirmed / partially confirmed) whose lines carry a
 * catalogue link and haven't been resolved as unavailable/substituted.
 * Available = stock_qty − committed. Free-text order lines (no
 * catalogue_item_id) can't be counted — committed is complete for
 * marketplace-originated orders and grows more complete as the shop
 * becomes the main path.
 */
export const fetchCommittedQuantities = async (supplierId) => {
  try {
    const { data: orders, error: e1 } = await supabase
      .from('supplier_orders')
      .select('id')
      .eq('supplier_profile_id', supplierId)
      .in('status', ['sent', 'confirmed', 'partially_confirmed']);
    if (e1 || !orders?.length) return {};
    const { data: lines, error: e2 } = await supabase
      .from('supplier_order_items')
      .select('catalogue_item_id, quantity, status')
      .in('order_id', orders.map(o => o.id))
      .not('catalogue_item_id', 'is', null)
      .in('status', ['pending', 'confirmed']);
    if (e2) return {};
    const map = {};
    (lines ?? []).forEach(l => {
      map[l.catalogue_item_id] = (map[l.catalogue_item_id] || 0) + Number(l.quantity || 0);
    });
    return map;
  } catch {
    return {};
  }
};

// ─── Picking (Phase 3) ───────────────────────────────────────────────────────

/**
 * Order lines for the pick list, with the linked catalogue row embedded
 * (barcode for scan-to-pick, photo + pack semantics for the picker UI).
 */
export const fetchOrderItemsForPicking = async (orderId) => {
  const { data, error } = await supabase
    .from('supplier_order_items')
    .select('*, catalogue:supplier_catalogue_items(id, barcode, image_url, pack_size, pack_unit, unit_size, category)')
    .eq('order_id', orderId)
    .order('item_name', { ascending: true });
  if (error) throw error;
  return data ?? [];
};

/** Record what actually came off the shelf. pickedQty null = un-pick. */
export const setItemPicked = async (itemId, pickedQty, note = null) => {
  const { data, error } = await supabase
    .from('supplier_order_items')
    .update({
      picked_qty: pickedQty,
      picked_at: pickedQty != null ? new Date().toISOString() : null,
      pick_note: note,
    })
    .eq('id', itemId)
    .select()
    .single();
  if (error) throw error;
  return data;
};

// Upload a product photo to the public `catalogue-images` bucket and write
// the public URL onto the catalogue row. Same pattern as uploadSupplierLogo.
export const uploadCatalogueImage = async (supplierId, itemId, file) => {
  if (!file) throw new Error('No file provided');
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${supplierId}/${itemId}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from('catalogue-images')
    .upload(path, file, { upsert: true, cacheControl: '3600' });
  if (uploadError) throw uploadError;
  const { data: { publicUrl } } = supabase.storage
    .from('catalogue-images')
    .getPublicUrl(path);
  const cacheBustedUrl = `${publicUrl}?t=${Date.now()}`;
  return updateCatalogueItem(itemId, { image_url: cacheBustedUrl });
};

// ─── Invoices ────────────────────────────────────────────────────────────────

export const fetchInvoices = async (supplierId, { status } = {}) => {
  let query = supabase
    .from('supplier_invoices')
    .select('*')
    .eq('supplier_id', supplierId)
    .order('issue_date', { ascending: false });

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
};

// ─── Deliveries ──────────────────────────────────────────────────────────────

export const fetchDeliveries = async (supplierId, { from, to } = {}) => {
  let query = supabase
    .from('supplier_deliveries')
    .select('*')
    .eq('supplier_id', supplierId)
    .order('scheduled_date', { ascending: true });

  if (from) query = query.gte('scheduled_date', from);
  if (to)   query = query.lte('scheduled_date', to);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
};

// ─── Overview KPIs ───────────────────────────────────────────────────────────

// Server-side aggregate RPC (migration 20260424120000). Returns per-currency
// revenue buckets plus order/delivery counts. Frontend can convert currencies
// via the home_currency on supplier_profiles + its Frankfurter cache.
export const fetchSupplierKPIsV2 = async (supplierId) => {
  const { data, error } = await supabase.rpc('get_supplier_kpis', {
    p_supplier_id: supplierId,
  });
  if (error) throw error;
  return data;
};

// Legacy KPI shape consumed by SupplierOverview. Kept as a thin adapter over
// the new RPC so existing UI renders without changes. Falls back to the
// original per-table queries if the RPC is unavailable for any reason.
export const fetchSupplierKPIs = async (supplierId) => {
  try {
    const kpis = await fetchSupplierKPIsV2(supplierId);
    if (kpis && !kpis.error) {
      // Sum outstanding across all currencies (UI is currency-agnostic today).
      const outstandingByCcy = kpis.revenue?.outstanding ?? {};
      const outstandingAmount = Object.values(outstandingByCcy)
        .reduce((sum, v) => sum + Number(v ?? 0), 0);

      const [invoicesRes, catalogueRes] = await Promise.all([
        supabase
          .from('supplier_invoices')
          .select('id, status')
          .eq('supplier_id', supplierId)
          .eq('status', 'overdue'),
        supabase
          .from('supplier_catalogue_items')
          .select('id', { count: 'exact', head: true })
          .eq('supplier_id', supplierId),
      ]);

      return {
        pendingOrders: (kpis.orders?.new ?? 0) + (kpis.orders?.in_progress ?? 0),
        overdueInvoices: invoicesRes.data?.length ?? 0,
        outstandingAmount,
        catalogueCount: catalogueRes.count ?? 0,
        totalOrders: kpis.orders?.total ?? 0,
        raw: kpis,
      };
    }
  } catch (err) {
    console.warn('[fetchSupplierKPIs] RPC path failed, using fallback:', err);
  }

  // Fallback: original per-table aggregation.
  const [ordersRes, invoicesRes, catalogueRes] = await Promise.all([
    supabase
      .from('supplier_orders')
      .select('id, status, created_at')
      .eq('supplier_profile_id', supplierId),
    supabase
      .from('supplier_invoices')
      .select('id, status, amount')
      .eq('supplier_id', supplierId),
    supabase
      .from('supplier_catalogue_items')
      .select('id', { count: 'exact', head: true })
      .eq('supplier_id', supplierId),
  ]);

  const orders = ordersRes.data ?? [];
  const invoices = invoicesRes.data ?? [];
  const catalogueCount = catalogueRes.count ?? 0;

  const pendingOrders = orders.filter(o => ['sent', 'confirmed', 'partially_confirmed'].includes(o.status)).length;
  const overdueInvoices = invoices.filter(i => i.status === 'overdue').length;
  const outstandingAmount = invoices
    .filter(i => ['sent', 'overdue'].includes(i.status))
    .reduce((sum, i) => sum + (i.amount ?? 0), 0);

  return {
    pendingOrders,
    overdueInvoices,
    outstandingAmount,
    catalogueCount,
    totalOrders: orders.length,
  };
};

// ─── Clients (tenant_suppliers) ──────────────────────────────────────────────

export const fetchClients = async (supplierId) => {
  const { data, error } = await supabase
    .from('tenant_suppliers')
    .select('*, tenants(id, name, vessel_name)')
    .eq('supplier_id', supplierId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
};

// One yacht client's relationship row (status, payment terms, credit limit,
// notes) + the tenant it points at. Keyed by tenant so both the clients list
// (c.tenants.id) and an order (order.tenant_id) resolve to the same profile.
export const fetchClientProfile = async (supplierId, tenantId) => {
  const { data, error } = await supabase
    .from('tenant_suppliers')
    .select('*, tenants(id, name, vessel_name)')
    .eq('supplier_id', supplierId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

// Every order this supplier has fulfilled for one yacht — with items so the
// profile can value each order. RLS also scopes to the caller's supplier.
export const fetchClientOrders = async (supplierId, tenantId) => {
  const { data, error } = await supabase
    .from('supplier_orders')
    .select('*, supplier_order_items(*)')
    .eq('supplier_profile_id', supplierId)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
};

// ─── Email Aliases ───────────────────────────────────────────────────────────

export const fetchAliases = async (supplierId) => {
  const { data, error } = await supabase
    .from('supplier_email_aliases')
    .select('*')
    .eq('supplier_id', supplierId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
};

export const addAlias = async (supplierId, email) => {
  const token = crypto.randomUUID();
  const { data, error } = await supabase
    .from('supplier_email_aliases')
    .insert({
      supplier_id: supplierId,
      email: email.toLowerCase().trim(),
      verified: false,
      is_primary: false,
      verification_token: token,
      verification_sent_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;

  try {
    await supabase.functions.invoke('sendAliasVerification', {
      body: { aliasId: data.id, email: data.email, token },
    });
  } catch (err) {
    console.warn('[addAlias] verification email send failed (non-fatal):', err);
  }

  return data;
};

export const resendAliasVerification = async (aliasId) => {
  const token = crypto.randomUUID();
  const { data, error } = await supabase
    .from('supplier_email_aliases')
    .update({
      verification_token: token,
      verification_sent_at: new Date().toISOString(),
    })
    .eq('id', aliasId)
    .select()
    .single();
  if (error) throw error;

  try {
    await supabase.functions.invoke('sendAliasVerification', {
      body: { aliasId: data.id, email: data.email, token },
    });
  } catch (err) {
    console.warn('[resendAliasVerification] send failed (non-fatal):', err);
  }

  return data;
};

export const deleteAlias = async (aliasId) => {
  const { error } = await supabase
    .from('supplier_email_aliases')
    .delete()
    .eq('id', aliasId);
  if (error) throw error;
};

export const verifyAliasByToken = async (token) => {
  const { data, error } = await supabase.rpc('verify_supplier_email_alias', {
    p_token: token,
  });
  if (error) throw error;
  return data;
};

// ─── Team ────────────────────────────────────────────────────────────────────

export const fetchTeamMembers = async (supplierId) => {
  const { data, error } = await supabase
    .from('supplier_contacts')
    .select('*')
    .eq('supplier_id', supplierId)
    .eq('active', true)
    .order('permission_tier', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
};

export const fetchPendingInvites = async (supplierId) => {
  const { data, error } = await supabase
    .from('supplier_invites')
    .select('*')
    .eq('supplier_id', supplierId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
};

export const createInvite = async ({ supplierId, email, name, permissionTier, role, supplierName }) => {
  const { data, error } = await supabase
    .from('supplier_invites')
    .insert({
      supplier_id: supplierId,
      email: email.toLowerCase().trim(),
      name: name?.trim() || null,
      permission_tier: permissionTier,
      role,
    })
    .select()
    .single();
  if (error) throw error;

  try {
    await supabase.functions.invoke('sendSupplierInvite', {
      body: {
        inviteId: data.id,
        email: data.email,
        name: data.name,
        token: data.token,
        supplierName,
      },
    });
  } catch (err) {
    console.warn('[createInvite] email send failed (non-fatal):', err);
  }
  return data;
};

export const revokeInvite = async (inviteId) => {
  const { data, error } = await supabase.rpc('revoke_supplier_invite', { p_invite_id: inviteId });
  if (error) throw error;
  return data;
};

export const nudgeInvite = async (inviteId, supplierName) => {
  const { data: existing, error: readErr } = await supabase
    .from('supplier_invites')
    .select('nudge_count, email, token, name')
    .eq('id', inviteId)
    .single();
  if (readErr) throw readErr;

  const { data: invite, error } = await supabase
    .from('supplier_invites')
    .update({
      nudge_count: (existing.nudge_count ?? 0) + 1,
      last_nudged_at: new Date().toISOString(),
    })
    .eq('id', inviteId)
    .select()
    .single();
  if (error) throw error;

  try {
    await supabase.functions.invoke('sendSupplierInvite', {
      body: {
        inviteId: invite.id,
        email: invite.email,
        name: invite.name,
        token: invite.token,
        isNudge: true,
        supplierName,
      },
    });
  } catch (err) {
    console.warn('[nudgeInvite] send failed:', err);
  }
  return invite;
};

export const removeMember = async (contactId) => {
  const { data, error } = await supabase.rpc('remove_supplier_member', { p_contact_id: contactId });
  if (error) throw error;
  return data;
};

export const updateMemberTier = async (contactId, newTier) => {
  const { data, error } = await supabase.rpc('update_supplier_member_tier', {
    p_contact_id: contactId,
    p_new_tier: newTier,
  });
  if (error) throw error;
  return data;
};

// ─── Ownership ──────────────────────────────────────────────────────────────

export const requestOwnershipTransfer = async (toContactId, supplierName, fromName) => {
  const { data, error } = await supabase.rpc('request_supplier_ownership_transfer', {
    p_to_contact_id: toContactId,
  });
  if (error) throw error;

  if (data?.ok) {
    try {
      await supabase.functions.invoke('sendOwnershipTransfer', {
        body: {
          token: data.token,
          targetEmail: data.target_email,
          supplierName,
          fromName,
        },
      });
    } catch (err) {
      console.warn('[requestOwnershipTransfer] send failed:', err);
    }
  }
  return data;
};

export const confirmOwnershipTransfer = async (token) => {
  const { data, error } = await supabase.rpc('confirm_supplier_ownership_transfer', {
    p_token: token,
  });
  if (error) throw error;
  return data;
};

// ─── Invite acceptance (public read + accept) ───────────────────────────────

export const fetchInvitePublic = async (token) => {
  const { data, error } = await supabase.rpc('get_supplier_invite_public', { p_token: token });
  if (error) throw error;
  return data;
};

export const acceptInvite = async (token, fullName) => {
  const { data, error } = await supabase.rpc('accept_supplier_invite', {
    p_token: token,
    p_full_name: fullName,
  });
  if (error) throw error;
  return data;
};

// ─── Invoicing (settings + generation) ──────────────────────────────────────

// Fetch the full supplier_profiles row, including the invoicing fields added
// in migration 20260428100000. The settings page uses every column.
export const fetchSupplierProfileById = async (supplierId) => {
  const { data, error } = await supabase
    .from('supplier_profiles')
    .select('*')
    .eq('id', supplierId)
    .single();
  if (error) throw error;
  return data;
};

// Upload a supplier logo to the public `supplier-logos` bucket and write the
// resulting public URL onto invoice_logo_url. Path scheme:
//   supplier-logos/{supplier_id}/logo.{ext}
//
// upsert:true means re-uploading with the same extension overwrites. If the
// supplier swaps from PNG → JPG the old file is left behind (cheap garbage,
// not worth the complexity to clean up automatically).
export const uploadSupplierLogo = async (supplierId, file) => {
  if (!file) throw new Error('No file provided');
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `${supplierId}/logo.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from('supplier-logos')
    .upload(path, file, { upsert: true, cacheControl: '3600' });
  if (uploadError) throw uploadError;
  const { data: { publicUrl } } = supabase.storage
    .from('supplier-logos')
    .getPublicUrl(path);
  // Bust any CDN cache by appending the upload timestamp.
  const cacheBustedUrl = `${publicUrl}?t=${Date.now()}`;
  await updateSupplierProfile(supplierId, { invoice_logo_url: cacheBustedUrl });
  return cacheBustedUrl;
};

// All invoices for a single order. Used by SupplierOrderDetail to decide
// whether the Documents → Invoice row says "Generate" or "Open".
export const fetchInvoicesForOrder = async (orderId) => {
  const { data, error } = await supabase
    .from('supplier_invoices')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
};

// Generate a supplier invoice via the generateSupplierInvoice edge function.
// `options` shape:
//   {
//     line_categories: { [item_id]: vat_category_key },
//     issue_date?: string (ISO date),
//     due_date?: string (ISO date),
//     payment_terms_days?: number,
//     notes?: string,
//     bonded_supply?: boolean,
//   }
// Resolves to { invoice_id, invoice_number, pdf_url, signed_url } on success.
export const generateSupplierInvoice = async (orderId, options = {}) => {
  const { data, error } = await supabase.functions.invoke('generateSupplierInvoice', {
    body: { orderId, options },
  });
  if (error) throw error;
  return data;
};

// Mint a short-lived signed URL for an invoice PDF via the
// getInvoiceSignedUrl edge function. The function handles the auth check
// (supplier-owner OR vessel tenant-member of the order's tenant) so this
// works from both portals.
export const fetchInvoiceSignedUrl = async (invoiceId) => {
  const { data, error } = await supabase.functions.invoke('getInvoiceSignedUrl', {
    body: { invoiceId },
  });
  if (error) throw error;
  return data; // { signed_url, expires_at }
};

// Generalised signed-URL helper for supplier-side documents (Sprint 9b).
// documentKind ∈ 'invoice' | 'order_pdf' | 'delivery_note' | 'delivery_note_signed'.
// documentId is the parent row id (supplier_invoices.id for 'invoice',
// supplier_orders.id for the three order-document kinds). Auth and bucket
// routing happen inside the getDocumentSignedUrl edge function.
export const fetchDocumentSignedUrl = async (documentKind, documentId) => {
  const { data, error } = await supabase.functions.invoke('getDocumentSignedUrl', {
    body: { documentKind, documentId },
  });
  if (error) throw error;
  return data; // { signed_url, expires_at }
};

// Render the Cargo-branded order acknowledgement PDF for an order. Updates
// supplier_orders.order_pdf_url + .order_pdf_generated_at server-side and
// returns a fresh 10-min signed URL the caller can open immediately.
// Resolves to { pdf_path, signed_url, expires_at, generated_at }.
export const generateOrderPdf = async (orderId) => {
  const { data, error } = await supabase.functions.invoke('generateOrderPdf', {
    body: { orderId },
  });
  if (error) throw error;
  return data;
};

// Render the Cargo-branded UNSIGNED delivery note for an order. Mints (or
// reuses) the delivery_signing_token, embeds it as a QR code, uploads the
// PDF, and stamps supplier_orders.delivery_note_pdf_url +
// .delivery_note_generated_at + .delivery_signing_token (first time only).
// Server returns 409 if crew_signed_at is already set — at that point
// the supplier should open the signed copy via fetchDocumentSignedUrl
// ('delivery_note_signed', orderId).
// Resolves to { pdf_path, signing_token, signed_url, expires_at, generated_at, token_was_new }.
export const generateDeliveryNote = async (orderId) => {
  const { data, error } = await supabase.functions.invoke('generateDeliveryNote', {
    body: { orderId },
  });
  if (error) throw error;
  return data;
};

// Email the unsigned delivery note's signing link to the receiving party
// (Sprint 9b Commit 7). Server validates the order has a generated delivery
// note (refuses with 409 otherwise — does NOT auto-regenerate), enforces
// a 30-minute idempotency window unless force=true is passed, and stamps
// supplier_orders.delivery_note_emailed_at on success.
//
// Resolves to:
//   { ok: true, message_id, sent_to, attached, force }                     (sent)
//   { ok: true, already_sent: true, sent_at }                              (within idempotency window)
// Throws on:
//   - Order not found (404)
//   - Delivery note not generated yet (409)
//   - Recipient email not on file (422)
//   - Resend send failure (502)
export const sendDeliveryNoteEmails = async (orderId, { force = false } = {}) => {
  const { data, error } = await supabase.functions.invoke('sendDeliveryNoteEmails', {
    body: { orderId, force },
  });
  if (error) throw error;
  return data;
};

// ─── Quote workflow (Sprint 9.5) ────────────────────────────────────────────

// Set the supplier's quoted price on a single line. The auto-accept BEFORE
// trigger (migration 20260429100100) inspects this update and:
//   - if quoted = estimated AND same currency → quote_status='agreed',
//     agreed_* populated automatically
//   - otherwise → quote_status='quoted' for vessel review
//
// Caller may omit quoted_currency, in which case we don't touch the column.
// (The trigger reads NEW.quoted_currency — leaving it unset means the row's
// existing value stays, which is fine on first quote because the
// estimated_currency is also already populated.)
export const quoteOrderItem = async (itemId, { quoted_price, quoted_currency } = {}) => {
  const updates = { quoted_price };
  if (quoted_currency != null) updates.quoted_currency = quoted_currency;
  const { data, error } = await supabase
    .from('supplier_order_items')
    .update(updates)
    .eq('id', itemId)
    .select()
    .single();
  if (error) throw error;
  return data;
};

// Confirm a line. Combines the legacy fulfilment-status flip with the new
// quote workflow:
//
//   - If the line has no quoted_price yet, defaults to estimated_price /
//     estimated_currency. The auto-accept trigger then flips quote_status
//     to 'agreed' (since quoted = estimated by definition here).
//   - If the caller passes a different quoted_price, the trigger marks the
//     line as 'quoted' and the vessel sees it for explicit acceptance.
//   - If the line already has a quoted_price and the caller doesn't pass
//     a new one, only the fulfilment status flips — quote state is left
//     untouched.
//
// Two queries by design: the read-then-write makes the auto-quote-on-confirm
// path explicit. Negligible at single-supplier traffic volumes.
export const confirmOrderItem = async (itemId, { quoted_price, quoted_currency } = {}) => {
  const { data: current, error: fetchErr } = await supabase
    .from('supplier_order_items')
    .select('quoted_price, estimated_price, estimated_currency')
    .eq('id', itemId)
    .single();
  if (fetchErr) throw fetchErr;

  const updates = { status: 'confirmed' };

  if (current.quoted_price == null) {
    // Auto-quote at estimated price (or the override caller passed in).
    updates.quoted_price    = quoted_price ?? current.estimated_price;
    updates.quoted_currency = quoted_currency ?? current.estimated_currency;
  } else if (quoted_price !== undefined && Number(quoted_price) !== Number(current.quoted_price)) {
    // Re-quote with a new price.
    updates.quoted_price    = quoted_price;
    updates.quoted_currency = quoted_currency ?? current.estimated_currency;
  }
  // else: already quoted, caller didn't change the price → leave quote alone.

  const { data, error } = await supabase
    .from('supplier_order_items')
    .update(updates)
    .eq('id', itemId)
    .select()
    .single();
  if (error) throw error;
  return data;
};

// ─── Reviews ─────────────────────────────────────────────────────────────────

// The reviews for the caller's supplier profile, each traceable to its
// order + vessel (get_my_supplier_reviews RPC). Anonymous to other buyers,
// but the fulfilling supplier sees the vessel so they can offer support.
export const fetchMySupplierReviews = async () => {
  const { data, error } = await supabase.rpc('get_my_supplier_reviews');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    orderId: r.order_id,
    vesselName: r.vessel_name || 'A vessel',
    deliveryDate: r.delivery_date,
    rating: Number(r.rating) || 0,
    note: r.note || '',
    createdAt: r.created_at,
    reply: r.supplier_reply || '',
    repliedAt: r.replied_at,
    quality: r.quality_rating != null ? Number(r.quality_rating) : null,
    delivery: r.delivery_rating != null ? Number(r.delivery_rating) : null,
    service: r.service_rating != null ? Number(r.service_rating) : null,
  }));
};

// Post / edit / clear a public reply to a review (reply_to_review RPC).
// Pass an empty string to clear. Only affects reviews on your own profile.
export const replyToReview = async (reviewId, reply) => {
  const { error } = await supabase.rpc('reply_to_review', {
    p_review_id: reviewId, p_reply: reply,
  });
  if (error) throw error;
};

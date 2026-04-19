import { supabase } from '../../../lib/supabaseClient';

// ─── Profile ────────────────────────────────────────────────────────────────

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
    .select('*, supplier_order_items(*)')
    .eq('id', orderId)
    .single();
  if (error) throw error;
  return data;
};

export const updateOrderStatus = async (orderId, status) => {
  const { data, error } = await supabase
    .from('supplier_orders')
    .update({ status })
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

export const fetchSupplierKPIs = async (supplierId) => {
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

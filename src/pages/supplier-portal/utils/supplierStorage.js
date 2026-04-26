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
    .select(`
      *,
      supplier_order_items(*),
      assigned_contact:supplier_contacts!assigned_to_supplier_contact_id(id, name, email, role)
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

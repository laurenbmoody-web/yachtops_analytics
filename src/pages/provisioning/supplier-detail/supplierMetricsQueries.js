// Sprint 9c.2 — Supplier detail page data layer.
//
// Focused, single-purpose async query functions feeding the metrics
// aggregator (supplierMetrics.js). Co-located with the page rather than
// living in provisioningStorage.js so the supplier-detail data layer is
// one directory.
//
// Conventions (per brief):
//   - every export returns { data, error }, never throws
//   - explicit column lists, never select('*')
//   - RLS-scoped (no service-role); the supplier_orders read policy
//     already scopes to the caller's tenant via the tenant_members chain
//   - delivery_ledger is intentionally NOT queried — it's a receipt log
//     with no FK to supplier_orders.id and no delivered_at, so on-time
//     delivery is out of scope this sprint (backlog item). Discrepancy
//     comes from supplier_orders.status instead.

import { supabase } from '../../../lib/supabaseClient';

// Shared column projection for the orders fetch. Items are nested so the
// aggregator can compute per-order totals; provisioning_lists carries the
// department text[] used for Command-view bucketing and Chief scoping.
const SUPPLIER_ORDER_SELECT = `
  id,
  status,
  currency,
  created_at,
  list_id,
  vessel_name,
  supplier_profile_id,
  supplier_order_items (
    id,
    quantity,
    agreed_price,
    quoted_price,
    estimated_price,
    item_name
  ),
  provisioning_lists:list_id (
    id,
    title,
    department
  )
`;

// 1. All orders for a supplier, newest-first. Role-agnostic — ONE query
//    path for Command and Chief alike. Department scoping for the Chief
//    view is applied JS-side in the aggregator against the joined
//    provisioning_lists.department text[]. Rationale: the embedded
//    inner-join + array .contains() PostgREST pattern can't be
//    live-verified from the sandbox and its failure mode (Chief silently
//    sees every order) is too high-risk. Per-supplier order volume is
//    tens of rows, so JS-side filtering is the production shape — cheap,
//    single code path, scoping enforced one layer up where it's testable.
//
//    Left join on the board so orders on empty-department boards — and
//    any with a null list_id — still return; those land in the
//    "Uncategorised" bucket in the aggregator's Command-view breakdown.
export const fetchSupplierOrdersForMetrics = async (supplierProfileId) => {
  const { data, error } = await supabase
    .from('supplier_orders')
    .select(SUPPLIER_ORDER_SELECT)
    .eq('supplier_profile_id', supplierProfileId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
};

// 2. Flat list of every order item for the supplier, for the top-items
//    calculation. The parent order is embedded (INNER) purely to scope by
//    supplier_profile_id and to expose each item's order id / currency /
//    created_at / board department.
//
//    Department narrowing for the Chief view is applied in the aggregator
//    against the in-scope order-id set (already resolved from query #1),
//    rather than a triple-nested embedded .contains() here — nested
//    embedded array filters are the fragile part of PostgREST and the
//    aggregator already has the authoritative scoped order set.
export const fetchSupplierOrderItemsForMetrics = async (supplierProfileId) => {
  const { data, error } = await supabase
    .from('supplier_order_items')
    .select(`
      id,
      quantity,
      agreed_price,
      quoted_price,
      estimated_price,
      item_name,
      supplier_orders:order_id!inner (
        id,
        supplier_profile_id,
        currency,
        created_at,
        list_id,
        provisioning_lists:list_id (
          id,
          department
        )
      )
    `)
    .eq('supplier_orders.supplier_profile_id', supplierProfileId);
  return { data: data || [], error };
};

// 3. Tenant-wide discrepancy benchmark for the "vs fleet avg X%" footer
//    on the Discrepancy Rate card. RLS already scopes supplier_orders to
//    the caller's tenant, so an unfiltered count IS the fleet (this
//    tenant's) total — no explicit tenant predicate needed or possible
//    (supplier_orders has no tenant_id column; scoping is via the policy
//    chain through provisioning_lists → tenant_members).
//
//    Two head-only exact counts (no row payload) keep this cheap even on
//    tenants with thousands of orders.
export const fetchTenantDiscrepancyFleetAvg = async () => {
  const totalRes = await supabase
    .from('supplier_orders')
    .select('id', { count: 'exact', head: true });
  if (totalRes.error) return { data: null, error: totalRes.error };

  const discRes = await supabase
    .from('supplier_orders')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'delivered_with_discrepancies');
  if (discRes.error) return { data: null, error: discRes.error };

  const total = totalRes.count || 0;
  const withIssues = discRes.count || 0;
  const percent = total > 0 ? Math.round((withIssues / total) * 1000) / 10 : 0;
  return { data: { total, withIssues, percent }, error: null };
};

// 4. Global departments lookup. The departments table has no tenant_id —
//    departments are shared across all tenants. One fetch per page load;
//    the aggregator maps each order's board department NAME(s) onto these
//    rows for id (the canonical bundle dept key) + colour. Alphabetical
//    to match the directory ordering used elsewhere.
export const fetchDepartments = async () => {
  const { data, error } = await supabase
    .from('departments')
    .select('id, name, color')
    .order('name', { ascending: true });
  return { data: data || [], error };
};

-- Sprint 9c.2 Commit 1.5b — vessel-side read access to supplier_order_activity
--
-- The original migration (20260427140000_supplier_order_activity.sql) added
-- only a supplier-side read policy gating on public.get_user_supplier_id().
-- Vessel-side users (tenant_members for the order's tenant) had no read
-- access — the activity feed in the new SupplierOrderDrawer needs this
-- granted so chief stews can see what's happened on their own orders.
--
-- Mirrors the supplier-side policy in shape: same SELECT-only access,
-- gated on tenant_members membership instead of supplier_id ownership.

CREATE POLICY "vessel_read_own_order_activity"
  ON public.supplier_order_activity
  FOR SELECT USING (
    EXISTS (
      SELECT 1
        FROM public.supplier_orders so
        JOIN public.tenant_members tm ON tm.tenant_id = so.tenant_id
       WHERE so.id = supplier_order_activity.order_id
         AND tm.user_id = auth.uid()
         AND COALESCE(tm.active, true) = true
    )
  );

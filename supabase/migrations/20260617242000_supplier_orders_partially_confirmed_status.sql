-- ─────────────────────────────────────────────────────────────────────────────
-- 20260617242000_supplier_orders_partially_confirmed_status.sql
--
-- Re-adds 'partially_confirmed' to supplier_orders.status. The
-- 8-stage lifecycle migration (20260430110500) collapsed the value
-- into 'confirmed' on the supplier side and dropped it from the
-- CHECK, but the multi-supplier quote-approval flow (#1178) needs
-- it back: a supplier order with some lines agreed + others still
-- awaiting_quote shouldn't claim 'confirmed'.
--
-- Mirror of the provisioning_lists widening in 20260617240000.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.supplier_orders
  DROP CONSTRAINT IF EXISTS supplier_orders_status_check;

ALTER TABLE public.supplier_orders
  ADD CONSTRAINT supplier_orders_status_check
  CHECK (status IN (
    'draft',
    'sent',
    'confirmed',
    'partially_confirmed',
    'dispatched',
    'out_for_delivery',
    'received',
    'invoiced',
    'paid'
  ));

COMMENT ON CONSTRAINT supplier_orders_status_check
  ON public.supplier_orders IS
  'Lifecycle. partially_confirmed lands when the vessel approves a
   quote that only covers some lines on this order — the rest are
   still awaiting_quote. Distinct from confirmed which means the
   whole order is locked.';

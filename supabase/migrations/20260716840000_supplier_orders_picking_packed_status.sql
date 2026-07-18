-- ─────────────────────────────────────────────────────────────────────────────
-- 20260716840000_supplier_orders_picking_packed_status.sql
--
-- Adds 'picking' and 'packed' to supplier_orders.status.
--
-- The supplier portal has always run a 7-step fulfilment workflow
-- (Received → Confirming → Picking → Packed → Dispatched → Delivered →
-- Invoiced), but the 8-stage lifecycle migration (20260430110500)
-- collapsed the canonical CHECK down to draft / sent / confirmed /
-- dispatched / out_for_delivery / received / invoiced / paid and never
-- carried the two intermediate supplier-side stages back into the DB.
--
-- The pick screen writes status='picking' on entry and status='packed'
-- on "Mark packed", so both writes were bouncing off
-- supplier_orders_status_check — the supplier could confirm an order but
-- never get it out of picking. This re-widens the CHECK so those two
-- stages persist. They sit between 'confirmed' and 'dispatched'.
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
    'picking',
    'packed',
    'dispatched',
    'out_for_delivery',
    'received',
    'invoiced',
    'paid'
  ));

COMMENT ON CONSTRAINT supplier_orders_status_check
  ON public.supplier_orders IS
  'Lifecycle. picking + packed are the supplier-side fulfilment stages
   between confirmed and dispatched: picking is set when the supplier
   opens the pick screen, packed when every line is picked. partially_
   confirmed lands when the vessel approves a quote covering only some
   lines.';

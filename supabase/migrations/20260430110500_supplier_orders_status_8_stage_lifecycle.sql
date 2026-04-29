-- Sprint 9c.2a — supplier_orders.status to 8-stage lifecycle
--
-- Renames + adds + squashes the order lifecycle states to match the
-- editorial Orders tab vocabulary (Sprint 9c.2). Quoted is intentionally
-- NOT stored as a status value — it's derived at render time from the
-- per-line supplier_order_items.quote_status aggregation. Operationally,
-- orders go from 'sent' directly to 'confirmed'; the visual lifecycle
-- shows Quoted as an intermediate step when lines have quotes pending
-- review.
--
-- Mapping:
--
--   Old value           → New value
--   draft                  draft                (unchanged — pre-send)
--   sent                   sent                 (unchanged)
--   confirming             confirmed            (rename)
--   confirmed              confirmed            (unchanged)
--   partially_confirmed    confirmed            (squashed — coarser model is fine)
--   pending                confirmed            (legacy alias — backfill to confirmed)
--   picking                dispatched           (squashed)
--   packed                 dispatched           (squashed)
--   dispatched             dispatched           (unchanged)
--   delivered              received             (rename)
--   invoiced               invoiced             (unchanged — see below for paid bump)
--
-- Then conditionally:
--   invoiced AND supplier_invoices.status='paid' → paid
--
-- Anything left out-of-set defaults to 'sent' as a defensive last resort
-- (shouldn't fire — picking/packed audit confirmed no real production
-- writes; the squash is lossless per the audit findings).

-- ─── Drop existing CHECK ────────────────────────────────────────────
-- Original (from migration 20260417300000) constrained:
--   status IN ('draft','sent','confirmed','partially_confirmed')
-- Was never relaxed via committed migration, but production may have
-- relaxed it manually (signDeliveryNote writes 'received' / 'delivered'
-- successfully — implies the constraint isn't blocking anymore).
ALTER TABLE public.supplier_orders
  DROP CONSTRAINT IF EXISTS supplier_orders_status_check;

-- ─── Backfill — map old → new ───────────────────────────────────────

UPDATE public.supplier_orders SET status = 'confirmed'  WHERE status = 'confirming';
UPDATE public.supplier_orders SET status = 'confirmed'  WHERE status = 'partially_confirmed';
UPDATE public.supplier_orders SET status = 'confirmed'  WHERE status = 'pending';
UPDATE public.supplier_orders SET status = 'dispatched' WHERE status IN ('picking','packed');
UPDATE public.supplier_orders SET status = 'received'   WHERE status = 'delivered';

-- Conditional paid bump — invoiced rows whose invoice is settled
UPDATE public.supplier_orders so
   SET status = 'paid'
 WHERE so.status = 'invoiced'
   AND EXISTS (
     SELECT 1 FROM public.supplier_invoices si
      WHERE si.order_id = so.id
        AND si.status = 'paid'
   );

-- Defensive catch-all: anything that doesn't match the new set falls back
-- to 'sent'. Should be 0 rows on a clean dataset; logged via NOTICE for
-- visibility if it fires.
DO $$
DECLARE
  v_offcount integer;
BEGIN
  SELECT COUNT(*) INTO v_offcount
    FROM public.supplier_orders
   WHERE status NOT IN ('draft','sent','confirmed','dispatched','out_for_delivery','received','invoiced','paid');
  IF v_offcount > 0 THEN
    RAISE NOTICE '[supplier_orders] % rows with unrecognised status — defaulting to ''sent''', v_offcount;
    UPDATE public.supplier_orders
       SET status = 'sent'
     WHERE status NOT IN ('draft','sent','confirmed','dispatched','out_for_delivery','received','invoiced','paid');
  END IF;
END $$;

-- ─── New 8-value CHECK ──────────────────────────────────────────────

ALTER TABLE public.supplier_orders
  ADD CONSTRAINT supplier_orders_status_check
    CHECK (status IN (
      'draft',
      'sent',
      'confirmed',
      'dispatched',
      'out_for_delivery',
      'received',
      'invoiced',
      'paid'
    ));

COMMENT ON COLUMN public.supplier_orders.status IS
  'Order lifecycle: draft (pre-send) → sent → confirmed → dispatched → out_for_delivery → received → invoiced → paid. Quoted is a derived display state computed from per-line supplier_order_items.quote_status, not stored.';

-- ─── country_code on supplier_profiles ─────────────────────────────
-- Already exists as `business_country` (ISO 2-letter, added by Sprint 9a's
-- 20260428100000_supplier_profiles_invoicing migration). No new column
-- needed. Leaving this comment as a reference for future readers.

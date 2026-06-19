-- ─────────────────────────────────────────────────────────────────────────────
-- 20260617222000_supplier_orders_vessel_approved_seen.sql
--
-- Adds two timestamps on supplier_orders so the supplier portal can
-- surface a clear "vessel approved your quote" signal on the bell
-- without colliding with the existing revised_at flow:
--
--   vessel_approved_at        — set by approveAllQuotes() on the
--                                vessel side at the moment the order
--                                flips to confirmed via the auto-
--                                approval path. Null on first-cycle
--                                confirms by the supplier themselves.
--
--   vessel_approved_seen_at  — supplier acks the marker by either
--                                viewing the order detail or clicking
--                                the bell-icon entry. Null = bell still
--                                counts this order.
--
-- A BEFORE UPDATE trigger keeps vessel_approved_seen_at in sync: if a
-- new vessel_approved_at lands (vessel re-approved after a prior
-- ack), the seen timestamp clears so the bell re-fires.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.supplier_orders
  ADD COLUMN IF NOT EXISTS vessel_approved_at      timestamptz,
  ADD COLUMN IF NOT EXISTS vessel_approved_seen_at timestamptz;

COMMENT ON COLUMN public.supplier_orders.vessel_approved_at IS
  'When the vessel''s approver / chief ran auto-approval on this
   order''s quotes. Sibling to confirmed_at but specifically marks
   the "vessel approved" path so we can light a one-time bell
   notification on the supplier portal.';

COMMENT ON COLUMN public.supplier_orders.vessel_approved_seen_at IS
  'When the supplier last acknowledged the vessel-approved marker —
   viewed the order detail or clicked the bell entry. Bell badge
   counts orders where vessel_approved_at IS NOT NULL AND
   (vessel_approved_seen_at IS NULL OR < vessel_approved_at).';

CREATE OR REPLACE FUNCTION public.clear_vessel_approved_seen_on_reapprove()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Re-approval lands ⇒ clear the ack so the badge re-fires for the
  -- supplier. Only triggers when vessel_approved_at actually moves
  -- forward; ordinary updates that don't touch it are ignored.
  IF NEW.vessel_approved_at IS DISTINCT FROM OLD.vessel_approved_at
     AND NEW.vessel_approved_at IS NOT NULL
     AND NEW.vessel_approved_seen_at IS NOT DISTINCT FROM OLD.vessel_approved_seen_at
  THEN
    NEW.vessel_approved_seen_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_orders_clear_vessel_approved_seen
  ON public.supplier_orders;

CREATE TRIGGER supplier_orders_clear_vessel_approved_seen
  BEFORE UPDATE ON public.supplier_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_vessel_approved_seen_on_reapprove();

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260617200000_supplier_order_items_revised_at.sql
--
-- Adds a revised_at timestamp on supplier_order_items so the supplier
-- portal can surface a clear "VESSEL REVISED" signal on lines the
-- vessel reopened after the supplier already confirmed.
--
-- Set by reopenOrderItem (vessel-side helper, see #1141) at the same
-- moment status drops back to 'pending'. Cleared by the supplier's
-- next confirm / substitute / mark-unavailable, so the chip
-- disappears the moment the supplier acks the revision.
--
-- The line_reopened activity event from #1141 stays — that's the
-- audit trail. This column is the "still needs attention" flag.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.supplier_order_items
  ADD COLUMN IF NOT EXISTS revised_at timestamptz;

COMMENT ON COLUMN public.supplier_order_items.revised_at IS
  'When the vessel last reopened this line after it had been confirmed /
   substituted / marked unavailable. Set by reopenOrderItem; cleared by
   the supplier''s next status change to confirmed / substituted /
   unavailable. Non-null means the supplier still owes a re-confirm.';

-- Belt-and-suspenders: a BEFORE UPDATE trigger that auto-clears
-- revised_at whenever a row leaves 'pending' for one of the
-- supplier-response states. Covers any future code path that
-- forgets to clear it explicitly.
CREATE OR REPLACE FUNCTION public.clear_revised_at_on_response()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'pending'
     AND NEW.status IN ('confirmed', 'substituted', 'unavailable')
     AND NEW.revised_at IS NOT DISTINCT FROM OLD.revised_at
  THEN
    NEW.revised_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_order_items_clear_revised_at
  ON public.supplier_order_items;

CREATE TRIGGER supplier_order_items_clear_revised_at
  BEFORE UPDATE ON public.supplier_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_revised_at_on_response();

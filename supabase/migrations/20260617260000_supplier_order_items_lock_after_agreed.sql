-- ─────────────────────────────────────────────────────────────────────────────
-- 20260617260000_supplier_order_items_lock_after_agreed.sql
--
-- Belt-and-suspenders for the post-confirm contract. After the
-- vessel approves a quote (#1169 / #1178) the line is meant to be
-- locked — every editable supplier-side surface already gates the
-- inputs behind status === 'pending', but a DB-level guard catches
-- anything that bypasses the UI (manual SQL, future code paths,
-- bulk imports, race conditions).
--
-- The trigger raises a clear error when:
--   - quote_status was 'agreed' AND price-y columns try to move
--     (quoted_price / agreed_price / quoted_currency / agreed_currency)
--   - status was 'confirmed' / 'substituted' / 'unavailable' AND
--     supplier-facing fields move (quantity / unit / size /
--     substitute_description)
--
-- Two columns stay editable in all states:
--   - supplier_item_note  — the supplier may always add context
--   - notes               — vessel-set notes; mirrored from the board
--
-- Reopening is the supported path:
--   - Vessel side: reopenOrderItem (#1141)
--   - Supplier side: supplierRequestLineReopen (this PR, see
--     supplierStorage.js) — flips status back to 'pending' and
--     logs 'supplier_requested_reopen' so the crew gets a clear
--     marker on their board.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_locked_supplier_order_items()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_price_locked     boolean;
  v_terms_locked     boolean;
  v_status_unchanged boolean;
BEGIN
  v_status_unchanged := NEW.status IS NOT DISTINCT FROM OLD.status;

  -- A status flip is the legitimate reopen path. The OLD column
  -- values stay as-is; the application layer is choosing to revisit
  -- the line. Let the row through and rely on application checks.
  IF NOT v_status_unchanged THEN
    RETURN NEW;
  END IF;

  -- Prices are locked once quote_status hits 'agreed'.
  v_price_locked := OLD.quote_status = 'agreed';

  -- qty / unit / size / substitute become locked once the line is
  -- committed on either side (confirmed / substituted / unavailable).
  v_terms_locked := OLD.status IN ('confirmed', 'substituted', 'unavailable');

  IF v_price_locked AND (
       NEW.quoted_price    IS DISTINCT FROM OLD.quoted_price
    OR NEW.agreed_price    IS DISTINCT FROM OLD.agreed_price
    OR NEW.quoted_currency IS DISTINCT FROM OLD.quoted_currency
    OR NEW.agreed_currency IS DISTINCT FROM OLD.agreed_currency
  ) THEN
    RAISE EXCEPTION 'Quote on item % is agreed — request a reopen before revising the price.',
      OLD.item_name
      USING ERRCODE = 'P0010';
  END IF;

  IF v_terms_locked AND (
       NEW.quantity                IS DISTINCT FROM OLD.quantity
    OR NEW.unit                    IS DISTINCT FROM OLD.unit
    OR NEW.size                    IS DISTINCT FROM OLD.size
    OR NEW.substitute_description  IS DISTINCT FROM OLD.substitute_description
  ) THEN
    RAISE EXCEPTION 'Line % is locked after %. Request a reopen before revising.',
      OLD.item_name, OLD.status
      USING ERRCODE = 'P0010';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_order_items_guard_locked
  ON public.supplier_order_items;

-- BEFORE UPDATE — sit in front of every other trigger so the
-- guard fires before any application-side mutation lands.
CREATE TRIGGER supplier_order_items_guard_locked
  BEFORE UPDATE ON public.supplier_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_locked_supplier_order_items();

COMMENT ON FUNCTION public.guard_locked_supplier_order_items() IS
  'Locks post-confirm fields on supplier_order_items. Allows status
   transitions (reopen path), allows note edits (notes /
   supplier_item_note). Blocks price / qty / unit / size /
   substitute_description while the status / quote_status are in
   their committed states. Raises P0010 with a human-readable
   message pointing the caller at the reopen flow.';

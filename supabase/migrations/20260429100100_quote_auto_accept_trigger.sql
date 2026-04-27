-- BEFORE UPDATE trigger that auto-accepts a quote when the supplier's
-- quoted_price exactly matches the vessel's estimated_price (and same
-- currency). Otherwise sets quote_status to 'quoted' and waits for the
-- vessel to accept / decline / query.
--
-- Currency must match for auto-accept — different currency on the quote
-- means the vessel needs to look at it (FX risk, no fuzzy threshold).
--
-- This is a BEFORE trigger so we can mutate NEW directly without a second
-- UPDATE. Fires only when quoted_price or quoted_currency actually changes,
-- so plain status updates (e.g. confirm fulfilment) don't churn quote state.

CREATE OR REPLACE FUNCTION public.handle_quote_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.quoted_price IS DISTINCT FROM OLD.quoted_price
     OR NEW.quoted_currency IS DISTINCT FROM OLD.quoted_currency THEN

    -- Always stamp the quote time when the quote changes.
    NEW.quoted_at := now();

    IF NEW.quoted_price IS NOT NULL
       AND NEW.quoted_price = NEW.estimated_price
       AND NEW.quoted_currency = NEW.estimated_currency THEN
      -- Auto-accept on exact match.
      NEW.agreed_price    := NEW.quoted_price;
      NEW.agreed_currency := NEW.quoted_currency;
      NEW.agreed_at       := now();
      NEW.quote_status    := 'agreed';
    ELSIF NEW.quoted_price IS NOT NULL THEN
      -- Quote differs from estimate — wait for vessel to accept.
      NEW.agreed_price    := NULL;
      NEW.agreed_currency := NULL;
      NEW.agreed_at       := NULL;
      NEW.quote_status    := 'quoted';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_order_items_quote_handler ON public.supplier_order_items;
CREATE TRIGGER supplier_order_items_quote_handler
  BEFORE UPDATE ON public.supplier_order_items
  FOR EACH ROW EXECUTE FUNCTION public.handle_quote_update();

COMMENT ON FUNCTION public.handle_quote_update IS
  'BEFORE UPDATE on supplier_order_items: auto-accepts a quote when quoted_price = estimated_price (and same currency), otherwise marks quote_status = quoted for vessel review.';

-- ─── Verification queries (run after apply) ──────────────────────────────
--
-- 1) Set up: pick a pending line and confirm its current state
--    SELECT id, quote_status, estimated_price, estimated_currency,
--           quoted_price, agreed_price
--      FROM public.supplier_order_items
--      WHERE status = 'pending'
--      LIMIT 1;
--
-- 2) Match-quote → expect quote_status='agreed', agreed_price set
--    UPDATE public.supplier_order_items
--      SET quoted_price = estimated_price,
--          quoted_currency = estimated_currency
--      WHERE id = '<id-from-step-1>';
--
-- 3) Mismatch-quote → expect quote_status='quoted', agreed_price NULL
--    UPDATE public.supplier_order_items
--      SET quoted_price = estimated_price + 5
--      WHERE id = '<another-pending-id>';

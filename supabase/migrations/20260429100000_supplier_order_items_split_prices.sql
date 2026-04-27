-- Split single unit_price into four distinct price fields.
-- Backfill carefully: existing 'pending' lines have only an estimated_price;
-- existing 'confirmed' / 'substituted' lines should treat their unit_price
-- as both quoted AND agreed (since the old single-value semantic effectively
-- meant "supplier accepted the vessel estimate").
--
-- unit_price column is NOT dropped here. Sprint 9a's generateSupplierInvoice
-- edge function still reads it; Sprint 9.5 Commit 5 switches the function
-- to agreed_price. After both sprints are stable, a future cleanup migration
-- can drop unit_price. Defence-in-depth.

ALTER TABLE public.supplier_order_items
  ADD COLUMN IF NOT EXISTS estimated_price numeric(10, 2),
  ADD COLUMN IF NOT EXISTS estimated_currency text,
  ADD COLUMN IF NOT EXISTS quoted_price numeric(10, 2),
  ADD COLUMN IF NOT EXISTS quoted_currency text,
  ADD COLUMN IF NOT EXISTS quoted_at timestamptz,
  ADD COLUMN IF NOT EXISTS agreed_price numeric(10, 2),
  ADD COLUMN IF NOT EXISTS agreed_currency text,
  ADD COLUMN IF NOT EXISTS agreed_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoiced_price numeric(10, 2),
  ADD COLUMN IF NOT EXISTS invoiced_currency text,
  ADD COLUMN IF NOT EXISTS quote_status text DEFAULT 'awaiting_quote'
    CHECK (quote_status IN (
      'awaiting_quote',     -- vessel sent, supplier hasn't quoted
      'quoted',             -- supplier quoted, awaiting vessel acceptance
      'agreed',             -- vessel accepted (or auto-accepted on match)
      'in_discussion',      -- vessel raised a query, thread open
      'declined',           -- vessel declined, line waiting for re-quote
      'unavailable'         -- supplier marked the item as unavailable
    ));

-- ─── Backfill from existing data ──────────────────────────────────────────
-- The order-level currency lives on supplier_orders, not the line item, so
-- each backfill clause subselects from there. Acceptable performance at
-- single-digit-thousand row counts; revisit if this grows.

-- 'pending' lines: vessel sent an estimate, no quote yet
UPDATE public.supplier_order_items
SET
  estimated_price    = unit_price,
  estimated_currency = (SELECT currency FROM public.supplier_orders WHERE id = order_id),
  quote_status       = 'awaiting_quote'
WHERE status = 'pending' AND estimated_price IS NULL;

-- 'confirmed' lines: treat existing unit_price as quoted AND agreed
UPDATE public.supplier_order_items
SET
  estimated_price    = unit_price,
  estimated_currency = (SELECT currency FROM public.supplier_orders WHERE id = order_id),
  quoted_price       = unit_price,
  quoted_currency    = (SELECT currency FROM public.supplier_orders WHERE id = order_id),
  quoted_at          = updated_at,
  agreed_price       = unit_price,
  agreed_currency    = (SELECT currency FROM public.supplier_orders WHERE id = order_id),
  agreed_at          = updated_at,
  quote_status       = 'agreed'
WHERE status = 'confirmed' AND agreed_price IS NULL;

-- 'unavailable' lines: nothing to quote, just record the estimate
UPDATE public.supplier_order_items
SET
  estimated_price    = unit_price,
  estimated_currency = (SELECT currency FROM public.supplier_orders WHERE id = order_id),
  quote_status       = 'unavailable'
WHERE status = 'unavailable' AND estimated_price IS NULL;

-- 'substituted' lines: same shape as confirmed (was quoted and accepted)
UPDATE public.supplier_order_items
SET
  estimated_price    = unit_price,
  estimated_currency = (SELECT currency FROM public.supplier_orders WHERE id = order_id),
  quoted_price       = unit_price,
  quoted_currency    = (SELECT currency FROM public.supplier_orders WHERE id = order_id),
  quoted_at          = updated_at,
  agreed_price       = unit_price,
  agreed_currency    = (SELECT currency FROM public.supplier_orders WHERE id = order_id),
  agreed_at          = updated_at,
  quote_status       = 'agreed'
WHERE status = 'substituted' AND agreed_price IS NULL;

-- ─── Indexes + comments ──────────────────────────────────────────────────

-- Partial index on the active negotiation states only — small, high-churn
-- subset that the supplier order page filters / counts on.
CREATE INDEX IF NOT EXISTS supplier_order_items_quote_status_idx
  ON public.supplier_order_items(quote_status)
  WHERE quote_status IN ('quoted', 'in_discussion', 'declined');

COMMENT ON COLUMN public.supplier_order_items.estimated_price IS
  'Vessel-side estimated price when the order was sent. Frozen.';
COMMENT ON COLUMN public.supplier_order_items.quoted_price IS
  'Supplier-side quoted price. Updates on each re-quote.';
COMMENT ON COLUMN public.supplier_order_items.agreed_price IS
  'Final accepted price. Auto-set when quoted=estimated, otherwise set by vessel acceptance. Frozen on agree.';
COMMENT ON COLUMN public.supplier_order_items.invoiced_price IS
  'Snapshot at invoice generation. Catches any divergence between agreed and what the supplier billed.';
COMMENT ON COLUMN public.supplier_order_items.quote_status IS
  'Quote workflow state, separate from the order line status (which tracks fulfilment: pending/confirmed/packed/etc).';

-- ─── Verification queries (run after apply) ──────────────────────────────
--
-- Sanity-check the backfill landed cleanly:
--
--   SELECT quote_status, count(*)
--     FROM public.supplier_order_items
--     GROUP BY 1 ORDER BY 1;
--
-- Sample a few rows to eyeball price/currency populated correctly:
--
--   SELECT id, status, quote_status,
--          unit_price, estimated_price, quoted_price, agreed_price,
--          estimated_currency, agreed_currency
--     FROM public.supplier_order_items
--     ORDER BY updated_at DESC
--     LIMIT 10;
--
-- Confirm no rows ended up in an inconsistent state (estimated NULL but
-- status non-pending):
--
--   SELECT id, status, quote_status, estimated_price
--     FROM public.supplier_order_items
--     WHERE estimated_price IS NULL AND status <> 'pending';

-- ============================================================
-- supplier_return_tasks.order_id — link a routed return to the
-- supplier_orders row it was filed against.
--
-- Part A of the return-to-order linking sprint. Nullable column so
-- a return that wasn't matched to an order (no picker selection at
-- routing time) stands alone — the common case during transition
-- and a valid permanent state.
--
-- ON DELETE SET NULL: if a supplier_orders row is later removed,
-- the return survives — it just loses the link, not the audit
-- record of what was returned.
--
-- Partial index keyed on WHERE order_id IS NOT NULL keeps the index
-- small (most rows during transition will be NULL); engages the
-- per-order lookup used by the portal order-detail RETURNS panel.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS, pg_constraint probe for the
-- FK, CREATE INDEX IF NOT EXISTS.
-- ============================================================

ALTER TABLE public.supplier_return_tasks
  ADD COLUMN IF NOT EXISTS order_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supplier_return_tasks_order_id_fkey'
      AND conrelid = 'public.supplier_return_tasks'::regclass
  ) THEN
    ALTER TABLE public.supplier_return_tasks
      ADD CONSTRAINT supplier_return_tasks_order_id_fkey
      FOREIGN KEY (order_id)
      REFERENCES public.supplier_orders(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_supplier_return_tasks_order_id
  ON public.supplier_return_tasks (order_id)
  WHERE order_id IS NOT NULL;

COMMENT ON COLUMN public.supplier_return_tasks.order_id IS
  'Optional link to the supplier_orders row this return is filed against. Populated when the crew picks an order in the Cargo-route confirm dialog on the slip page. NULL when no order was selected — return then stands alone on /supplier/returns and is not surfaced on any order detail page.';

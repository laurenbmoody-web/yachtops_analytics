-- ─────────────────────────────────────────────────────────────────────────────
-- 20260617180000_supplier_order_items_requested_snapshot.sql
--
-- Preserves the vessel's original ask when the supplier overrides quantity,
-- unit, or size on a line. The live columns (quantity, unit, size) become
-- the supplier's actual values; the new requested_* columns hold what the
-- crew sent. The supplier-side UI renders a struck-through original next
-- to the bold actual whenever they differ, so both sides can see exactly
-- what changed against the original order.
--
-- Snapshot at send time is done in provisioningStorage.createSupplierOrder
-- (see the same-day commit) — requested_* are seeded equal to the live
-- columns when the line is first inserted. Subsequent supplier edits only
-- mutate the live columns; requested_* stay frozen.
--
-- Backfill: existing rows (sent before this column lands) get requested_*
-- copied from the current values — there's no way to recover the original
-- ask for those, and "no change" is the right assumption.
--
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.supplier_order_items
  ADD COLUMN IF NOT EXISTS requested_quantity numeric,
  ADD COLUMN IF NOT EXISTS requested_unit     text,
  ADD COLUMN IF NOT EXISTS requested_size     text;

UPDATE public.supplier_order_items
   SET requested_quantity = COALESCE(requested_quantity, quantity),
       requested_unit     = COALESCE(requested_unit, unit),
       requested_size     = COALESCE(requested_size, size)
 WHERE requested_quantity IS NULL
    OR requested_unit IS NULL
    OR requested_size IS NULL;

COMMENT ON COLUMN public.supplier_order_items.requested_quantity IS
  'Quantity the vessel asked for at send time. Frozen — only requested_quantity
   captures the original ask; supplier-side edits mutate the live quantity
   column instead. UI shows struck-through requested_quantity when it differs
   from quantity.';
COMMENT ON COLUMN public.supplier_order_items.requested_unit IS
  'Unit the vessel asked for at send time (e.g. "box", "kg"). Frozen — see
   requested_quantity.';
COMMENT ON COLUMN public.supplier_order_items.requested_size IS
  'Pack size the vessel asked for at send time (e.g. "500g"). Frozen — see
   requested_quantity.';

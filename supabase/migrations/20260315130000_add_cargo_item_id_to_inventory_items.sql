-- Migration: Add cargo_item_id to inventory_items
-- Adds a stable, human-readable unique identifier to every inventory item.
-- Format: CARGO-000001, CARGO-000002, etc. (per-tenant sequential)
-- Existing items are backfilled safely using row_number() ordered by created_at.

-- 1. Add the column (nullable first so existing rows don't fail)
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS cargo_item_id TEXT;

-- 2. Add a unique index (partial — only enforces uniqueness where value is not null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_cargo_item_id
  ON public.inventory_items (cargo_item_id)
  WHERE cargo_item_id IS NOT NULL;

-- 3. Backfill existing rows that have no cargo_item_id yet
-- Uses row_number() ordered by created_at per tenant to assign stable sequential IDs
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      id,
      'CARGO-' || LPAD(ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at ASC, id ASC)::TEXT, 6, '0') AS new_cargo_id
    FROM public.inventory_items
    WHERE cargo_item_id IS NULL
  LOOP
    UPDATE public.inventory_items
    SET cargo_item_id = r.new_cargo_id
    WHERE id = r.id
      AND cargo_item_id IS NULL;
  END LOOP;
END;
$$;

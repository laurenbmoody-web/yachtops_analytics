-- Migration: Add atomic cargo_item_id auto-assignment trigger
-- Fixes: duplicate key value violates unique constraint "idx_inventory_items_cargo_item_id"
-- Root cause: client-side read-then-write ID generation causes race conditions on concurrent inserts.
-- Solution: Move ID generation to a DB BEFORE INSERT trigger using pg_advisory_xact_lock
--           for atomic per-tenant sequential assignment.

-- 1. Create the trigger function
CREATE OR REPLACE FUNCTION public.assign_cargo_item_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next_num  BIGINT;
  v_max_id    TEXT;
  v_lock_key  BIGINT;
BEGIN
  -- Only assign if not already set
  IF NEW.cargo_item_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Use a per-tenant advisory lock to serialize concurrent inserts
  -- Convert tenant_id UUID to a stable bigint lock key
  v_lock_key := abs(hashtext(NEW.tenant_id::TEXT));
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Find the current max numeric suffix for this tenant
  SELECT cargo_item_id INTO v_max_id
  FROM public.inventory_items
  WHERE tenant_id = NEW.tenant_id
    AND cargo_item_id IS NOT NULL
    AND cargo_item_id ~ '^CARGO-[0-9]+$'
  ORDER BY (regexp_replace(cargo_item_id, '^CARGO-', '')::BIGINT) DESC
  LIMIT 1;

  IF v_max_id IS NOT NULL THEN
    v_next_num := (regexp_replace(v_max_id, '^CARGO-', ''))::BIGINT + 1;
  ELSE
    v_next_num := 1;
  END IF;

  NEW.cargo_item_id := 'CARGO-' || LPAD(v_next_num::TEXT, 6, '0');
  RETURN NEW;
END;
$$;

-- 2. Attach the trigger (BEFORE INSERT so the value is set before the unique index check)
DROP TRIGGER IF EXISTS trg_assign_cargo_item_id ON public.inventory_items;
CREATE TRIGGER trg_assign_cargo_item_id
  BEFORE INSERT ON public.inventory_items
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_cargo_item_id();

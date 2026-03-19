-- Migration: Ensure location-first columns exist on inventory_items
-- Idempotent fix for: column inventory_items.location does not exist

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS sub_location TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS quantity NUMERIC DEFAULT 0;

-- Indexes for location-based queries (idempotent)
CREATE INDEX IF NOT EXISTS idx_inventory_items_location
  ON public.inventory_items(tenant_id, location);

CREATE INDEX IF NOT EXISTS idx_inventory_items_sub_location
  ON public.inventory_items(tenant_id, location, sub_location);

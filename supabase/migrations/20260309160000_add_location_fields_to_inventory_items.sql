-- Migration: Add location-first fields to inventory_items
-- Adds location, sub_location, tags, and quantity fields for simplified schema

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS sub_location TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS quantity NUMERIC DEFAULT 0;

-- Indexes for location-based queries
CREATE INDEX IF NOT EXISTS idx_inventory_items_location ON public.inventory_items(tenant_id, location);
CREATE INDEX IF NOT EXISTS idx_inventory_items_sub_location ON public.inventory_items(tenant_id, location, sub_location);

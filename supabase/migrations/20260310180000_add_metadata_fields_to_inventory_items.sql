-- Migration: Add extended metadata fields to inventory_items
-- All new columns are optional and do not break existing item creation logic

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS brand TEXT,
  ADD COLUMN IF NOT EXISTS year INTEGER,
  ADD COLUMN IF NOT EXISTS tasting_notes TEXT,
  ADD COLUMN IF NOT EXISTS barcode TEXT,
  ADD COLUMN IF NOT EXISTS expiry_date DATE,
  ADD COLUMN IF NOT EXISTS default_location_id UUID REFERENCES public.vessel_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS restock_level NUMERIC;

-- Index for barcode lookups
CREATE INDEX IF NOT EXISTS idx_inventory_items_barcode ON public.inventory_items(tenant_id, barcode);

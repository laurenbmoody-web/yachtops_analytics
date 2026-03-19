-- Migration: Add vessel_type_label column
-- Purpose: Store vessel type label separately from tenant type (VESSEL/PERSONAL)
-- Date: 2026-01-24

-- Add vessel_type_label column
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS vessel_type_label text;

-- Add comment for documentation
COMMENT ON COLUMN public.tenants.vessel_type_label IS 'Vessel type label (e.g., Motor Yacht, Sailing Yacht, Catamaran)';
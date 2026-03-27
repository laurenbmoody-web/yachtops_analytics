-- Add icon and color columns to inventory_locations for customisable folder appearance
ALTER TABLE inventory_locations
  ADD COLUMN IF NOT EXISTS icon text,
  ADD COLUMN IF NOT EXISTS color text;

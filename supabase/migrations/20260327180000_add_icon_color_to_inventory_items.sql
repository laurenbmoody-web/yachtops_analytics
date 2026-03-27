-- Add icon and color columns to inventory_items for quick visual customisation
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS icon text,
  ADD COLUMN IF NOT EXISTS color text;

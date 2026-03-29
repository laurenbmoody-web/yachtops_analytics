ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS is_alcohol boolean NOT NULL DEFAULT false;

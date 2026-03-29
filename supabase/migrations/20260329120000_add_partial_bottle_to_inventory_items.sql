-- Add partial_bottle column to inventory_items for tracking open/partial bottles of alcohol
-- Value is a fraction 0-1 representing fill level (e.g. 0.5 = half a bottle remaining)
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS partial_bottle numeric CHECK (partial_bottle >= 0 AND partial_bottle <= 1);

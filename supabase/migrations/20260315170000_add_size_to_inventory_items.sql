-- Add size column to inventory_items table
-- size = the measurable/variant size of the item (e.g. 500ml, 1L, 750ml, 330ml, 1kg)
-- This is separate from unit (bottle, can, box) which is the countable format

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS size TEXT DEFAULT NULL;

COMMENT ON COLUMN public.inventory_items.size IS 'Measurable or variant size of the item, e.g. 500ml, 1L, 750ml, 330ml, 1kg. Separate from unit (bottle, can, box).';

-- Add custom_fields JSONB column to inventory_items
-- This allows structured storage of fields like colour, batch_no, expiry_date
-- that don't have dedicated columns, instead of appending them to notes.

ALTER TABLE public.inventory_items
ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.inventory_items.custom_fields IS
  'Structured key-value store for fields detected during import that do not have a dedicated column (e.g. colour, batch_no). Values are queryable and filterable via JSONB operators.';

CREATE INDEX IF NOT EXISTS idx_inventory_items_custom_fields
  ON public.inventory_items USING gin(custom_fields);

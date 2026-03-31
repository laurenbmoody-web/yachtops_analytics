-- Update provisioning_items status CHECK constraint to support new status values:
--   draft, to_order, ordered, partial, not_received
-- Replaces old values: pending, short_delivered, not_delivered
-- 'received' and 'ordered' remain valid throughout.

-- 1. Migrate existing rows to new values before altering the constraint
UPDATE public.provisioning_items SET status = 'draft'        WHERE status = 'pending';
UPDATE public.provisioning_items SET status = 'partial'      WHERE status = 'short_delivered';
UPDATE public.provisioning_items SET status = 'not_received' WHERE status = 'not_delivered';

-- 2. Drop the old check constraint (name from the original migration)
ALTER TABLE public.provisioning_items
  DROP CONSTRAINT IF EXISTS provisioning_items_status_check;

-- 3. Add the new constraint with all valid values
ALTER TABLE public.provisioning_items
  ADD CONSTRAINT provisioning_items_status_check
  CHECK (status IN (
    'draft',
    'to_order',
    'ordered',
    'received',
    'partial',
    'not_received'
  ));

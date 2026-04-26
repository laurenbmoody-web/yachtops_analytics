-- Add assignment to supplier_orders
-- Allows a supplier order to be assigned to a specific team member
-- (a row in supplier_contacts). NULL = unassigned (default for incoming orders).

ALTER TABLE public.supplier_orders
  ADD COLUMN IF NOT EXISTS assigned_to_supplier_contact_id uuid
    REFERENCES public.supplier_contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS supplier_orders_assigned_to_idx
  ON public.supplier_orders(assigned_to_supplier_contact_id)
  WHERE assigned_to_supplier_contact_id IS NOT NULL;

COMMENT ON COLUMN public.supplier_orders.assigned_to_supplier_contact_id IS
  'Supplier team member responsible for this order. NULL = unassigned.';

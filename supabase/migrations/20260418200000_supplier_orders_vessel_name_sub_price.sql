-- Add vessel_name to supplier_orders so the public confirmation page can
-- display which vessel sent the order (supplier_name is the supplier's name).
ALTER TABLE public.supplier_orders
  ADD COLUMN IF NOT EXISTS vessel_name text;

-- Add substitution_price to supplier_order_items so suppliers can quote
-- a price when offering a substitute item.
ALTER TABLE public.supplier_order_items
  ADD COLUMN IF NOT EXISTS substitution_price numeric;

-- Enable realtime on supplier_orders so the board detail page receives
-- live updates when a supplier confirms.
ALTER PUBLICATION supabase_realtime ADD TABLE supplier_orders;

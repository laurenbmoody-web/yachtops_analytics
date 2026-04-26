-- Adds VAT-snapshot fields to supplier_order_items so historical invoices
-- stay correct even if the supplier's tax category settings change later.

ALTER TABLE public.supplier_order_items
  ADD COLUMN IF NOT EXISTS vat_category_key text,
  ADD COLUMN IF NOT EXISTS vat_rate_snapshot numeric(5,2);

COMMENT ON COLUMN public.supplier_order_items.vat_category_key IS
  'Category assigned to this line at invoice time. Resolves to supplier-effective rate.';
COMMENT ON COLUMN public.supplier_order_items.vat_rate_snapshot IS
  'Rate captured at invoice generation. Historical invoices stay correct if supplier settings change later.';

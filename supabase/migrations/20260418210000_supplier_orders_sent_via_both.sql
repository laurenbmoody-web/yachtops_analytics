-- Allow 'both' in sent_via when an order is sent via email AND WhatsApp
ALTER TABLE public.supplier_orders
  DROP CONSTRAINT IF EXISTS supplier_orders_sent_via_check;

ALTER TABLE public.supplier_orders
  ADD CONSTRAINT supplier_orders_sent_via_check
  CHECK (sent_via IN ('email', 'whatsapp', 'both', 'manual'));

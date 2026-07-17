-- Delivery ETA on an order, so a supplier can post "Out for delivery · ETA 14:00"
-- as an in-thread status pill that both sides see (the pill itself is a system
-- message; this column keeps the ETA on the order for reference).

alter table public.supplier_orders
  add column if not exists delivery_eta timestamptz;

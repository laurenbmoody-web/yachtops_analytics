-- Per-stage fulfilment timestamps on supplier_orders.
--
-- The order-detail timeline can now show a real time under each completed
-- step instead of a bare tick. `sent_at` and `confirmed_at` already exist;
-- this adds the remaining real lifecycle transitions. `picking`/`packed`
-- are display-only sub-steps (squashed into `dispatched` back in the
-- 8-stage lifecycle migration), so they get no column — only genuine
-- status transitions are stamped.

alter table public.supplier_orders
  add column if not exists dispatched_at timestamptz,
  add column if not exists delivered_at  timestamptz,
  add column if not exists invoiced_at   timestamptz,
  add column if not exists paid_at       timestamptz;

comment on column public.supplier_orders.dispatched_at is
  'When the order was marked dispatched (left the supplier). Stamped by updateOrderStatus.';
comment on column public.supplier_orders.delivered_at is
  'When the order was marked delivered/received at the vessel. Stamped by updateOrderStatus.';
comment on column public.supplier_orders.invoiced_at is
  'When the invoice was issued. Stamped by updateOrderStatus.';
comment on column public.supplier_orders.paid_at is
  'When the invoice was settled. Stamped by updateOrderStatus.';

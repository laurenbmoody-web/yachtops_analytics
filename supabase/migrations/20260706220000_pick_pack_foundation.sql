-- Phase 3 — pick/pack foundation.
--
-- 1. Per-line pick tracking on supplier_order_items: picked_qty is what
--    actually came off the shelf (short picks allowed), picked_at
--    stamps it, pick_note explains a short pick ("only 18 in stock").
-- 2. Stock becomes self-maintaining: when an order is DISPATCHED, a
--    trigger decrements supplier_catalogue_items.stock_qty by the
--    picked (fallback: ordered) quantity for catalogue-linked lines.
--    stock_decremented_at guards against double-fire if the status
--    bounces through dispatched more than once.

alter table public.supplier_order_items
  add column if not exists picked_qty numeric(12,2),
  add column if not exists picked_at  timestamptz,
  add column if not exists pick_note  text;

alter table public.supplier_orders
  add column if not exists stock_decremented_at timestamptz;

create or replace function public.apply_dispatch_stock_decrement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'dispatched'
     and old.status is distinct from 'dispatched'
     and new.stock_decremented_at is null then

    update public.supplier_catalogue_items ci
    set stock_qty = greatest(0, ci.stock_qty - x.qty),
        in_stock  = (greatest(0, ci.stock_qty - x.qty) > 0)
    from (
      select soi.catalogue_item_id, sum(coalesce(soi.picked_qty, soi.quantity, 0)) as qty
      from public.supplier_order_items soi
      where soi.order_id = new.id
        and soi.catalogue_item_id is not null
        and soi.status = 'confirmed'
      group by soi.catalogue_item_id
    ) x
    where ci.id = x.catalogue_item_id
      and ci.stock_qty is not null;  -- untracked stock stays untracked

    new.stock_decremented_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists supplier_orders_dispatch_stock on public.supplier_orders;
create trigger supplier_orders_dispatch_stock
  before update on public.supplier_orders
  for each row execute function public.apply_dispatch_stock_decrement();

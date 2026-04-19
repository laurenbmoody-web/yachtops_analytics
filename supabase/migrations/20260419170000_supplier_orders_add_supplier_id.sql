-- Add supplier_id FK to supplier_orders so that authenticated supplier users
-- can read orders directed at their supplier profile.
alter table public.supplier_orders
  add column if not exists supplier_profile_id uuid references public.supplier_profiles(id) on delete set null;

create index if not exists supplier_orders_profile_idx on public.supplier_orders(supplier_profile_id);

-- Allow suppliers to read and update orders linked to their profile
create policy "supplier_read_own_orders"
  on public.supplier_orders for select
  using (supplier_profile_id = public.get_user_supplier_id());

create policy "supplier_update_own_orders"
  on public.supplier_orders for update
  using (supplier_profile_id = public.get_user_supplier_id());

-- Allow suppliers to read/update items on their orders
create policy "supplier_read_own_order_items"
  on public.supplier_order_items for select
  using (
    order_id in (
      select id from public.supplier_orders
      where supplier_profile_id = public.get_user_supplier_id()
    )
  );

create policy "supplier_update_own_order_items"
  on public.supplier_order_items for update
  using (
    order_id in (
      select id from public.supplier_orders
      where supplier_profile_id = public.get_user_supplier_id()
    )
  );

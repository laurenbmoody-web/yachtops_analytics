-- Driver tracking on an order (Phase 1). Two modes:
--   * internal  — a supplier team member drives it; they update driver_status
--                 (assigned → on_the_way → arrived → delivered) + the ETA.
--   * external  — a third-party courier with their own tracking; the supplier
--                 just stores the courier name + tracking URL for the crew.
-- driver_name is denormalised so the crew (who can't read supplier_contacts)
-- can show who's delivering without an extra RPC.

alter table public.supplier_orders
  add column if not exists driver_contact_id uuid references public.supplier_contacts(id) on delete set null,
  add column if not exists driver_name        text,
  add column if not exists driver_status      text,
  add column if not exists courier_name       text,
  add column if not exists tracking_url        text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'supplier_orders_driver_status_check'
  ) then
    alter table public.supplier_orders
      add constraint supplier_orders_driver_status_check
      check (driver_status is null or driver_status in ('assigned', 'on_the_way', 'arrived', 'delivered'));
  end if;
end $$;

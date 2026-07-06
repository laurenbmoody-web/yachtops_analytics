-- Catalogue operational depth — the numbers a real supplier runs on.
--
-- 1. Per-product operational fields on supplier_catalogue_items:
--    reorder_point (replaces the UI's hardcoded low-stock threshold),
--    lead_time_days ("48h notice" as data instead of description text),
--    min_order_qty (case-only / minimum-2 products, enforced in the
--    marketplace basket).
-- 2. catalogue_item_costs — the supplier's own buy price, in a SEPARATE
--    table on purpose: crew_read_supplier_catalogue grants yacht crew
--    SELECT on every column of supplier_catalogue_items, so a cost
--    column there would publish every supplier's margin to their
--    customers. This table has supplier-only RLS and no crew policy.

alter table public.supplier_catalogue_items
  add column if not exists reorder_point  numeric(12,2),
  add column if not exists lead_time_days integer,
  add column if not exists min_order_qty  numeric(10,2);

create table if not exists public.catalogue_item_costs (
  catalogue_item_id uuid primary key references public.supplier_catalogue_items(id) on delete cascade,
  supplier_id       uuid not null references public.supplier_profiles(id) on delete cascade,
  cost_price        numeric(12,2),
  currency          text not null default 'EUR',
  updated_at        timestamptz not null default now()
);

create index if not exists catalogue_item_costs_supplier_idx
  on public.catalogue_item_costs (supplier_id);

alter table public.catalogue_item_costs enable row level security;

-- Supplier team only. Deliberately NO crew/tenant policy: margins are
-- the supplier's private business.
create policy "supplier_read_own_costs" on public.catalogue_item_costs
  for select using (supplier_id = get_user_supplier_id());

create policy "supplier_insert_costs" on public.catalogue_item_costs
  for insert with check (supplier_id = get_user_supplier_id());

create policy "supplier_update_costs" on public.catalogue_item_costs
  for update using (supplier_id = get_user_supplier_id());

create policy "supplier_delete_costs" on public.catalogue_item_costs
  for delete using (supplier_id = get_user_supplier_id());

create trigger catalogue_item_costs_updated_at
  before update on public.catalogue_item_costs
  for each row execute function public.set_supplier_updated_at();

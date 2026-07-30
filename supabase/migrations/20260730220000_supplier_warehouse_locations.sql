-- Warehouse locations — the supplier's storage map.
--
-- A supplier lays out their warehouse as a set of locations (bins/racks), each
-- with a code, an optional name, a temperature zone, and a sort_order that
-- doubles as the pick-path walking order. Catalogue products link to a location
-- via location_id so picking can show + route by it.

create table if not exists public.supplier_locations (
  id          uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.supplier_profiles(id) on delete cascade,
  code        text not null,
  name        text,
  zone        text not null default 'ambient' check (zone in ('ambient', 'chilled', 'frozen')),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_supplier_locations_supplier
  on public.supplier_locations (supplier_id, sort_order);

alter table public.supplier_locations enable row level security;

-- A supplier's own members (resolved by get_user_supplier_id()) can read and
-- manage their locations; nobody else can see them.
drop policy if exists supplier_locations_rw on public.supplier_locations;
create policy supplier_locations_rw on public.supplier_locations
  for all to authenticated
  using (supplier_id = get_user_supplier_id())
  with check (supplier_id = get_user_supplier_id());

grant select, insert, update, delete on public.supplier_locations to authenticated;

-- Link a catalogue product to a warehouse location (nullable; unset = unlocated).
alter table public.supplier_catalogue_items
  add column if not exists location_id uuid references public.supplier_locations(id) on delete set null;

comment on table public.supplier_locations is
  'Supplier warehouse map — bins/racks with code, temperature zone and pick-path sort_order.';
comment on column public.supplier_catalogue_items.location_id is
  'Warehouse location this product lives in (supplier_locations.id). Drives pick display + pick-path.';

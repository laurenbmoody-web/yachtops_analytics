-- Warehouse layout — the supplier's free-form floor plan (room shape + racks).
--
-- The visual designer lets a supplier draw their unit's room as any polygon and
-- place racks (position, size, orientation, temperature zone, bay/level counts)
-- anywhere on it. We store the whole arrangement as two JSON documents per
-- supplier: `shape` (the room polygon) and `racks` (the placed racks). The
-- per-slot product links continue to live on supplier_locations /
-- supplier_catalogue_items.location_id (wired in a later stage).

create table if not exists public.supplier_warehouse_layout (
  supplier_id uuid primary key references public.supplier_profiles(id) on delete cascade,
  shape       jsonb not null default '{"points":[[6,6],[94,6],[94,54],[6,54]]}'::jsonb,
  racks       jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.supplier_warehouse_layout enable row level security;

-- A supplier's own members (resolved by get_user_supplier_id()) can read and
-- manage their layout; nobody else can see it.
drop policy if exists supplier_warehouse_layout_rw on public.supplier_warehouse_layout;
create policy supplier_warehouse_layout_rw on public.supplier_warehouse_layout
  for all to authenticated
  using (supplier_id = get_user_supplier_id())
  with check (supplier_id = get_user_supplier_id());

grant select, insert, update, delete on public.supplier_warehouse_layout to authenticated;

comment on table public.supplier_warehouse_layout is
  'Supplier warehouse designer — room polygon (shape) and placed racks (racks) as JSON, one row per supplier.';

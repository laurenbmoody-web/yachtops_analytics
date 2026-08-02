-- Warehouse slots — the fine-grained link between a section of a rack (a single
-- bay × level cell in the head-on view) and a catalogue product.
--
-- The layout designer stores the room shape + racks (and nested walk-in rooms)
-- as JSON on supplier_warehouse_layout. Each rack face is a grid of sections
-- addressed by a stable code: `${rackCode}·${bay}·${level}` (e.g. "A1·03·G").
-- A slot pins one catalogue item to one such section, so the head-on view can
-- show what lives where and picking can later walk the whole layout.
--
-- One product may occupy several sections (many slots → one item); a section
-- holds at most one product (unique on supplier_id + section_code).

create table if not exists public.supplier_warehouse_slots (
  id                 uuid primary key default gen_random_uuid(),
  supplier_id        uuid not null references public.supplier_profiles(id) on delete cascade,
  section_code       text not null,
  rack_id            text,
  room_id            text,
  catalogue_item_id  uuid not null references public.supplier_catalogue_items(id) on delete cascade,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (supplier_id, section_code)
);

create index if not exists supplier_warehouse_slots_supplier_idx on public.supplier_warehouse_slots (supplier_id);
create index if not exists supplier_warehouse_slots_item_idx on public.supplier_warehouse_slots (catalogue_item_id);

alter table public.supplier_warehouse_slots enable row level security;

-- A supplier's own members (resolved by get_user_supplier_id()) can read and
-- manage their slots; nobody else can see them.
drop policy if exists supplier_warehouse_slots_rw on public.supplier_warehouse_slots;
create policy supplier_warehouse_slots_rw on public.supplier_warehouse_slots
  for all to authenticated
  using (supplier_id = get_user_supplier_id())
  with check (supplier_id = get_user_supplier_id());

grant select, insert, update, delete on public.supplier_warehouse_slots to authenticated;

comment on table public.supplier_warehouse_slots is
  'Warehouse designer — links a rack section (supplier_id + section_code) to a catalogue product, one row per occupied section.';

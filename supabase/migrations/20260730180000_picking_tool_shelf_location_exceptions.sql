-- Picking tool upgrade: shelf locations (pick path) + structured pick exceptions.
--
-- shelf_location on the catalogue drives the pick-path sort (walk the shelves in
-- order) and shows a location code on each pick line. pick_exception records a
-- structured short-pick / substitute reason (free text stays in pick_note), and
-- pick_skipped lets a picker defer a line and resolve it before packing.

alter table public.supplier_catalogue_items
  add column if not exists shelf_location text;

alter table public.supplier_order_items
  add column if not exists pick_exception text,
  add column if not exists pick_skipped boolean not null default false;

comment on column public.supplier_catalogue_items.shelf_location is
  'Free-form shelf/bin code (e.g. "A-12", "Cold-3"). Drives the picking pick-path sort.';
comment on column public.supplier_order_items.pick_exception is
  'Structured short-pick / substitute reason code: out_of_stock | damaged | short_dated | quality | substituted | other.';
comment on column public.supplier_order_items.pick_skipped is
  'Picker deferred this line during picking; must be resolved (picked or short) before the order can be packed.';

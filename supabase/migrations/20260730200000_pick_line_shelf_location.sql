-- Picking: per-line shelf location fallback.
--
-- shelf_location on supplier_catalogue_items is the canonical, product-level
-- location (persists across orders). But some order lines aren't linked to a
-- catalogue product (free-typed / manual items), so there's nowhere to store
-- their location. This adds a per-line fallback: the picker can set a location
-- on any line; catalogue-linked lines still write to the product, unlinked
-- lines write here.

alter table public.supplier_order_items
  add column if not exists shelf_location text;

comment on column public.supplier_order_items.shelf_location is
  'Per-line shelf/bin fallback used when the line has no catalogue product to carry the location. Read precedence: catalogue.shelf_location first, then this.';

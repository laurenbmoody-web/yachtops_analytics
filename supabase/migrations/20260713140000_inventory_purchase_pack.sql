-- Purchasing-unit vs stocking-unit conversion for inventory items (step C).
--
-- `unit` stays the STOCKING / consumption unit (what you count on the shelf and
-- deplete — e.g. "bottle"). These two optional columns describe how the item is
-- BOUGHT, so a delivery in the purchase unit can be converted into stock units:
--   purchase_unit — the unit stock is ordered in (e.g. "case")
--   pack_size     — how many stocking units are in one purchase unit (e.g. 12)
-- "1 case = 12 bottles". Both null → no conversion; receive adds as-is.
-- (Mirrors supplier_products.pack_size numeric(10,2) from the catalogue.)

alter table public.inventory_items
  add column if not exists purchase_unit text,
  add column if not exists pack_size numeric(10,2);

comment on column public.inventory_items.purchase_unit is
  'Unit stock is ordered/bought in (e.g. case). Stocking/consumption unit stays in `unit`.';
comment on column public.inventory_items.pack_size is
  'Stocking units per one purchase_unit (e.g. 12 bottles per case). Null = no conversion.';

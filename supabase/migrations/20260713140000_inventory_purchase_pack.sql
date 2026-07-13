-- Purchasing pack for inventory items (step C), aligned with the order-line
-- model (provisioning_items/supplier_order_items.units_per_pack).
--
-- `unit` stays the STOCKING / consumption unit (what you count and deplete —
-- e.g. "bottle"). Two optional columns describe how the item is BOUGHT, seeded
-- at receive time from the delivered line, so a case delivery expands to stock
-- and the item can display / reorder in the purchase unit:
--   purchase_unit  — the bulk unit stock is ordered in (the noun, e.g. "case")
--   units_per_pack — how many stocking units are in one purchase unit (e.g. 24)
-- Both null → no pack; receive adds as-is.
--
-- (pack_size from the first cut of this migration is dropped — one pack concept,
-- named units_per_pack to match the order lines.)

alter table public.inventory_items
  add column if not exists purchase_unit text,
  add column if not exists units_per_pack numeric;

alter table public.inventory_items
  drop column if exists pack_size;

comment on column public.inventory_items.purchase_unit is
  'Bulk unit stock is ordered/bought in (the noun, e.g. "case"). Stocking/consumption unit stays in `unit`.';
comment on column public.inventory_items.units_per_pack is
  'Stocking units per one purchase_unit (e.g. 24 bottles per case). Mirrors the order line''s units_per_pack; null = no pack.';

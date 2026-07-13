-- Bring the provisioning line onto the same pack model as inventory: `unit` is
-- the BASE unit you stock/count (bottle); the pack becomes a buying overlay.
--
--   unit           — base/stocking unit (bottle)          [existing]
--   size           — measure of one (500ml)               [existing, free text]
--   purchase_unit  — how it's bought (pack/case)           [NEW, nullable]
--   units_per_pack — base units per purchase unit (24)     [existing]
--
-- So "a pack holds 24 × 500ml bottles". Ordering stays in the purchase unit;
-- receive expands to base units (units_per_pack) and stocks in `unit`.

alter table public.provisioning_items
  add column if not exists purchase_unit text;

alter table public.supplier_order_items
  add column if not exists purchase_unit text;

comment on column public.provisioning_items.purchase_unit is
  'Bulk unit the line is bought by (e.g. "case"). Base/stocking unit stays in `unit`; units_per_pack bridges them.';
comment on column public.supplier_order_items.purchase_unit is
  'Mirror of provisioning_items.purchase_unit, frozen at send-time.';

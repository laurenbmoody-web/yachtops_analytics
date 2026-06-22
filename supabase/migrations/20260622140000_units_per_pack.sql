-- ─────────────────────────────────────────────────────────────────────────────
-- 20260622140000_units_per_pack.sql
--
-- Adds units_per_pack to provisioning_items + supplier_order_items so the
-- import wizard and the eventual receive-flow math have a structured place
-- for "how many units in each package the supplier ships".
--
-- Distinct from quantity (the chief's order count) and size (the supplier's
-- pack size). units_per_pack answers the *third* question the Excel sheets
-- track in their "Unit Per Vac Pack" column — e.g. salmon comes 1 per bag,
-- bananas come 5 per hand, octopus tentacles come 2 per pack.
--
-- Hidden in the v1 UI (we don't add a column to the board items table);
-- only the import wizard and storage layer write to it. A future "expand
-- receive math" pass will surface it as a derived chip on the row.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.provisioning_items
  ADD COLUMN IF NOT EXISTS units_per_pack numeric;

ALTER TABLE public.supplier_order_items
  ADD COLUMN IF NOT EXISTS units_per_pack numeric;

COMMENT ON COLUMN public.provisioning_items.units_per_pack IS
  'How many units the supplier ships per package — e.g. 1 (per bag), 5 (per
   hand), 2 (per tray). Distinct from quantity (order count) and size (the
   supplier''s pack size). Populated from the Excel-import "Unit Per Vac
   Pack" mapping or set inline by the chief. Hidden in v1 UI.';

COMMENT ON COLUMN public.supplier_order_items.units_per_pack IS
  'Mirror of provisioning_items.units_per_pack, frozen at send-time. The
   supplier sees this as part of the order spec; the receive-flow math uses
   it to compute expected pack counts vs delivered.';

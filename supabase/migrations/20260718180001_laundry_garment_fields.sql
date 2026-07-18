-- ─────────────────────────────────────────────────────────────────────────────
-- 20260718180001_laundry_garment_fields.sql
-- (renumbered again to 180001 — 180000 collided with 20260718180000_create_budgets,
--  causing a schema_migrations PK clash that blocked the whole migration push.
--  DDL is idempotent, so re-applying under the unique version is a safe no-op.)
--
-- Garment attributes for the Owner wardrobe catalogue: a clothing type/category
-- and a value/price (so the catalogue can filter by type and sort by price).
-- Nullable — only resident/owner garments tend to carry them.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.laundry_items ADD COLUMN IF NOT EXISTS garment_type text;
ALTER TABLE public.laundry_items ADD COLUMN IF NOT EXISTS garment_value numeric;
ALTER TABLE public.laundry_items ADD COLUMN IF NOT EXISTS garment_value_currency text;

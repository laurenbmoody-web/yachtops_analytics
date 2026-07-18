-- ─────────────────────────────────────────────────────────────────────────────
-- 20260718180000_laundry_garment_fields.sql
-- (renumbered from 20260718170000 to resolve a version collision with the
--  financial-accounts migration added on the same timestamp)
--
-- Garment attributes for the Owner wardrobe catalogue: a clothing type/category
-- and a value/price (so the catalogue can filter by type and sort by price).
-- Nullable — only resident/owner garments tend to carry them.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.laundry_items ADD COLUMN IF NOT EXISTS garment_type text;
ALTER TABLE public.laundry_items ADD COLUMN IF NOT EXISTS garment_value numeric;
ALTER TABLE public.laundry_items ADD COLUMN IF NOT EXISTS garment_value_currency text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260718190000_laundry_wardrobe_location.sql
--
-- Scope a wardrobe to a real vessel location, so it lives on the deck plan / map
-- like everything else. Mirrors laundry_items.area_location_id and
-- inventory_items.default_location_id — one shared physical-location tree.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.laundry_wardrobes
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.vessel_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS laundry_wardrobes_location_idx ON public.laundry_wardrobes (location_id);

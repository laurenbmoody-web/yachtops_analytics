-- ─────────────────────────────────────────────────────────────────────────────
-- 20260718210000_hotspot_storage_layer.sql
--
-- Add a "storage" pin layer to scan_hotspots — a cupboard/locker where things
-- physically live. Unlike a plain inventory pin (a free-standing item on the map,
-- e.g. artwork/furniture), a storage pin is a container that holds stock: both
-- wardrobe garments and inventory items can live inside one.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.scan_hotspots DROP CONSTRAINT IF EXISTS scan_hotspots_layer_check;
ALTER TABLE public.scan_hotspots ADD CONSTRAINT scan_hotspots_layer_check
  CHECK (layer = ANY (ARRAY['inventory'::text, 'defect'::text, 'safety'::text, 'job_helper'::text, 'general'::text, 'storage'::text]));

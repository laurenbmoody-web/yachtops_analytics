-- Multiple photos per laundry item.
--
-- `photos` holds the full ordered list (base64 data URLs for now, same as the
-- existing single-photo storage). The original `photo` column is kept and set
-- to the first photo, so existing readers (list row, trip drawer, widget) keep
-- working unchanged. Idempotent.

ALTER TABLE public.laundry_items
  ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: seed photos from any existing single photo.
UPDATE public.laundry_items
   SET photos = jsonb_build_array(photo)
 WHERE (photos IS NULL OR photos = '[]'::jsonb)
   AND photo IS NOT NULL AND photo <> '';

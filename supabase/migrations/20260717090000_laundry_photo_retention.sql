-- Laundry photo retention.
--
--  vessels.laundry_photo_retention_days  — per-vessel setting. NULL = keep
--     photos forever (default, nothing is ever deleted). A positive number of
--     days opts the vessel in: the scheduled laundry-photo-retention edge
--     function removes photo *files* (and clears any legacy base64) from items
--     whose delivery/log date is older than the window, keeping the record.
--
--  laundry_items.photos_expired_at        — stamped when a piece's photos were
--     purged by retention, so the job is idempotent and the UI can note it.
--
-- Additive + idempotent. Deletion is opt-in and only ever touches photos.

ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS laundry_photo_retention_days integer;

ALTER TABLE public.laundry_items
  ADD COLUMN IF NOT EXISTS photos_expired_at timestamptz;

-- Poster-frame thumbnails for vessel scans: captured at orient-save time,
-- stored in the vessel-scans bucket under {tenant_id}/thumbs/. Nullable —
-- scans oriented before this feature backfill on their next orient-save.
alter table public.vessel_scans
  add column if not exists thumb_path text;

-- "Location when fixed" for a defect.
--
-- When a defect is marked fixed & closed from the vessel map, we capture a
-- small image of the 3D view at its pin and keep it (plus the pin's position)
-- on the defect, so a completed defect keeps a visual record of WHERE it was —
-- even though its map pin drops off the live map (and could later be removed).
--
-- The image lives in the existing tenant-scoped `vessel-scans` storage bucket
-- under `${tenant_id}/defect-locations/...`, so no new bucket/policy is needed.

ALTER TABLE public.defects
  ADD COLUMN IF NOT EXISTS location_snapshot_path text,
  ADD COLUMN IF NOT EXISTS pin_position jsonb;

COMMENT ON COLUMN public.defects.location_snapshot_path IS
  'Storage path (vessel-scans bucket) of the captured 3D location image, taken when the defect was closed.';
COMMENT ON COLUMN public.defects.pin_position IS
  'Scan-local {x,y,z} of the defect map pin, snapshotted at close so the location survives pin deletion.';

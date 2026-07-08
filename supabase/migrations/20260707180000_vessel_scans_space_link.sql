-- 20260707180000_vessel_scans_space_link.sql
--
-- Link a Gaussian-splat scan to a Space in the vessel_locations tree, so the
-- Location Management gallery can show each space's real scan (or invite one).
-- Until now a scan carried only a free-text `deck` label and its own `name`;
-- a scan called "Bridge Salon" and the Space "Bridge Salon" were two unrelated
-- strings. `space_id` makes the room the hinge: one Space, one primary scan.
--
--   - nullable: a scan may exist before its Space does, and a Space may have
--     no scan yet (that is the "not scanned" state the gallery surfaces).
--   - ON DELETE SET NULL: archiving/removing a Space must not delete the scan
--     file; it just detaches.
--   - one primary scan per Space (partial unique index over the non-null,
--     non-archived rows). Re-capturing swaps the link rather than piling up.

ALTER TABLE public.vessel_scans
  ADD COLUMN IF NOT EXISTS space_id uuid
  REFERENCES public.vessel_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS vessel_scans_space_idx
  ON public.vessel_scans (tenant_id, space_id);

-- At most one scan bound to a given Space.
CREATE UNIQUE INDEX IF NOT EXISTS vessel_scans_one_per_space_uidx
  ON public.vessel_scans (space_id)
  WHERE space_id IS NOT NULL;

-- Best-effort backfill: match an existing scan to a Space by exact
-- (case/space-insensitive) name within the same tenant. Only fills scans that
-- aren't linked yet, and only when the name resolves to exactly one Space (so
-- an ambiguous name is left for a human to link, never mis-linked).
WITH space_match AS (
  SELECT s.id AS scan_id, vl.id AS space_id,
         count(*) OVER (PARTITION BY s.id) AS n
    FROM public.vessel_scans s
    JOIN public.vessel_locations vl
      ON vl.tenant_id = s.tenant_id
     AND vl.level = 'space'
     AND vl.is_archived = false
     AND lower(btrim(vl.name)) = lower(btrim(s.name))
   WHERE s.space_id IS NULL
),
unambiguous AS (
  SELECT scan_id, space_id FROM space_match WHERE n = 1
)
UPDATE public.vessel_scans s
   SET space_id = u.space_id
  FROM unambiguous u
 WHERE s.id = u.scan_id
   -- don't collide with the one-per-space rule if two scans share a name
   AND NOT EXISTS (
     SELECT 1 FROM public.vessel_scans t
      WHERE t.space_id = u.space_id
   );

COMMENT ON COLUMN public.vessel_scans.space_id IS
  'The Space (vessel_locations.level=space) this scan captures. Nullable; one primary scan per space. The free-text deck column is retained for legacy ordering.';

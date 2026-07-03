-- ─────────────────────────────────────────────────────────────────────────────
-- 20260703155416_vessel_scans.sql
--
-- WHAT: Foundation for the 3D vessel map — Gaussian-splat scans of vessel
--       spaces (galley, dry stores, …) rendered in-browser, with clickable
--       hotspots pinned in the scan's local 3D space. Two tables plus a
--       private storage bucket:
--
--         vessel_scans   one row per captured space; the .spz/.ply file lives
--                        in the 'vessel-scans' bucket at {tenant_id}/{file},
--                        re-signed on display. camera_* / splat_* jsonb hold
--                        the viewer's initial framing and mesh transform.
--         scan_hotspots  labelled 3D pins on a scan. `layer` buckets pins for
--                        UI filtering (inventory / defect / safety /
--                        job_helper / general); `detail` is a flex jsonb field
--                        so layers can carry type-specific data without new
--                        tables; `color` is denormalised from the layer at
--                        insert time. storage_location_id is a BARE uuid on
--                        purpose — the inventory layer isn't wired yet and
--                        there are two candidate targets (inventory_locations,
--                        vessel_locations); the FK is added when that layer
--                        graduates.
--
-- ACCESS: Read for every active tenant member (the map is a whole-crew
--       surface). Writes — scans and hotspots — are COMMAND/CHIEF only.
--       Mirrors the rota_shifts policy shape (tenant_read + command_chief
--       write on permission_tier, active = true).
--
-- IDEMPOTENCY: CREATE … IF NOT EXISTS + bucket/seed ON CONFLICT DO NOTHING +
--       DROP/CREATE POLICY. Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.vessel_scans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
  name            text NOT NULL,                 -- "Main Galley", "Lower Deck Dry Store"
  storage_path    text NOT NULL,                 -- '{tenant_id}/{scan_id}.spz' in vessel-scans bucket
  file_format     text NOT NULL DEFAULT 'spz',
  camera_position jsonb NOT NULL DEFAULT '{"x":0,"y":1.6,"z":3}',
  camera_target   jsonb NOT NULL DEFAULT '{"x":0,"y":1,"z":0}',
  splat_rotation  jsonb NOT NULL DEFAULT '{"x":0,"y":0,"z":0}',
  splat_scale     numeric NOT NULL DEFAULT 1,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.scan_hotspots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id             uuid NOT NULL REFERENCES public.vessel_scans(id) ON DELETE CASCADE,
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id),
  label               text NOT NULL,
  position            jsonb NOT NULL,            -- {"x":..,"y":..,"z":..} in splat local space
  storage_location_id uuid,                      -- bare uuid; FK deferred until inventory layer wires in
  layer               text NOT NULL DEFAULT 'general'
    CHECK (layer IN ('inventory','defect','safety','job_helper','general')),
  detail              jsonb NOT NULL DEFAULT '{}',
  color               text DEFAULT '#C65A1A',    -- denormalised from layer at insert
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vessel_scans_tenant_idx  ON public.vessel_scans  (tenant_id);
CREATE INDEX IF NOT EXISTS scan_hotspots_scan_idx   ON public.scan_hotspots (scan_id);
CREATE INDEX IF NOT EXISTS scan_hotspots_tenant_idx ON public.scan_hotspots (tenant_id);

COMMENT ON TABLE public.vessel_scans IS
  '3D Gaussian-splat scans of vessel spaces — files in the vessel-scans bucket, viewer framing in jsonb.';
COMMENT ON TABLE public.scan_hotspots IS
  'Labelled 3D pins on a vessel scan, bucketed by layer for UI filtering. COMMAND/CHIEF write.';

ALTER TABLE public.vessel_scans  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_hotspots ENABLE ROW LEVEL SECURITY;

-- ── RLS — mirrors rota_shifts: tenant_read + command_chief_write ────────────

DROP POLICY IF EXISTS "vessel_scans_tenant_read" ON public.vessel_scans;
CREATE POLICY "vessel_scans_tenant_read" ON public.vessel_scans
FOR SELECT TO authenticated
USING (tenant_id IN (
  SELECT tm.tenant_id FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid() AND tm.active = true));

DROP POLICY IF EXISTS "vessel_scans_command_chief_write" ON public.vessel_scans;
CREATE POLICY "vessel_scans_command_chief_write" ON public.vessel_scans
FOR ALL TO authenticated
USING (tenant_id IN (
  SELECT tm.tenant_id FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid() AND tm.active = true
    AND tm.permission_tier IN ('COMMAND', 'CHIEF')))
WITH CHECK (tenant_id IN (
  SELECT tm.tenant_id FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid() AND tm.active = true
    AND tm.permission_tier IN ('COMMAND', 'CHIEF')));

DROP POLICY IF EXISTS "scan_hotspots_tenant_read" ON public.scan_hotspots;
CREATE POLICY "scan_hotspots_tenant_read" ON public.scan_hotspots
FOR SELECT TO authenticated
USING (tenant_id IN (
  SELECT tm.tenant_id FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid() AND tm.active = true));

DROP POLICY IF EXISTS "scan_hotspots_command_chief_write" ON public.scan_hotspots;
CREATE POLICY "scan_hotspots_command_chief_write" ON public.scan_hotspots
FOR ALL TO authenticated
USING (tenant_id IN (
  SELECT tm.tenant_id FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid() AND tm.active = true
    AND tm.permission_tier IN ('COMMAND', 'CHIEF')))
WITH CHECK (tenant_id IN (
  SELECT tm.tenant_id FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid() AND tm.active = true
    AND tm.permission_tier IN ('COMMAND', 'CHIEF')));

-- ── Private scans bucket ─────────────────────────────────────────────────────
-- Splat files run 20–150MB, so a 200MB ceiling (vs vessel-vault's 50MB).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('vessel-scans', 'vessel-scans', false, 209715200)
ON CONFLICT (id) DO NOTHING;

-- Objects live under {tenant_id}/… — any active member of that tenant may
-- read (signed URLs); uploads are COMMAND/CHIEF (capturing scans is a senior
-- task; widen later if needed).
DROP POLICY IF EXISTS "vessel_scans_member_read" ON storage.objects;
CREATE POLICY "vessel_scans_member_read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'vessel-scans'
  AND EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = ((storage.foldername(name))[1])::uuid
      AND tm.user_id = auth.uid()
      AND tm.active = true
  )
);

DROP POLICY IF EXISTS "vessel_scans_command_chief_insert" ON storage.objects;
CREATE POLICY "vessel_scans_command_chief_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'vessel-scans'
  AND EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = ((storage.foldername(name))[1])::uuid
      AND tm.user_id = auth.uid()
      AND tm.active = true
      AND tm.permission_tier IN ('COMMAND', 'CHIEF')
  )
);

-- ── Dev seed — Main Galley scan (file uploaded manually to this exact path).
-- Fixed id so re-applying never duplicates the row.
INSERT INTO public.vessel_scans (id, tenant_id, name, storage_path, created_by)
VALUES (
  '5c1f4a9e-8d27-4b3a-9e61-2f7c0d84a3b5',
  'de051fc7-ec3b-4c22-96e8-b9834acda6aa',
  'Main Galley',
  'de051fc7-ec3b-4c22-96e8-b9834acda6aa/main-galley.spz',
  'b1ef6b14-d603-49c1-93d3-5f4089242812'
)
ON CONFLICT (id) DO NOTHING;

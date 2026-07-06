-- ─────────────────────────────────────────────────────────────────────────────
-- 20260706121712_vessel_scans_management_fields.sql
--
-- WHAT: Back-of-house fields for the self-serve scan pipeline (Manage scans):
--
--         deck        nullable label ("Main deck", "Lower deck") — organises
--                     scans the moment there's more than one; load-bearing
--                     for the future deck plan.
--         sort_order  explicit ordering; the map page now orders by
--                     (sort_order asc, created_at asc).
--         status      'uploading' while the file transfers, 'ready' once
--                     finalised. The map shows ready scans only; the manage
--                     surface shows incomplete uploads with retry/delete
--                     affordances — no orphaned rows pointing at nothing.
--         file_bytes  set at upload/replace so the manage list renders sizes
--                     without a storage round-trip. NULL on legacy rows.
--
--       Plus the missing COMMAND/CHIEF DELETE policy on the vessel-scans
--       bucket: replace-file (remove the old file once the new one is live)
--       and delete-scan both need it — Phase 1 only shipped SELECT + INSERT.
--
-- IDEMPOTENCY: ADD COLUMN IF NOT EXISTS, constraint guarded by name check,
--       DROP/CREATE POLICY. Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.vessel_scans ADD COLUMN IF NOT EXISTS deck text;
ALTER TABLE public.vessel_scans ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE public.vessel_scans ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready';
ALTER TABLE public.vessel_scans ADD COLUMN IF NOT EXISTS file_bytes bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vessel_scans_status_check'
  ) THEN
    ALTER TABLE public.vessel_scans
      ADD CONSTRAINT vessel_scans_status_check CHECK (status IN ('uploading', 'ready'));
  END IF;
END $$;

COMMENT ON COLUMN public.vessel_scans.status IS
  'uploading = file transfer in flight/abandoned; ready = live on the map.';

-- Objects live under {tenant_id}/… — COMMAND/CHIEF of that tenant may delete
-- (replace-file cleanup and scan deletion). Mirrors the insert policy shape.
DROP POLICY IF EXISTS "vessel_scans_command_chief_delete" ON storage.objects;
CREATE POLICY "vessel_scans_command_chief_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'vessel-scans'
  AND EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = ((storage.foldername(name))[1])::uuid
      AND tm.user_id = auth.uid()
      AND tm.active = true
      AND tm.permission_tier IN ('COMMAND', 'CHIEF')
  )
);

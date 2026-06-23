-- ─────────────────────────────────────────────────────────────────────────────
-- 20260623140000_vessel_documents.sql
--
-- WHAT: A vessel-wide master documents vault — a real file/folder tree (like a
--       computer's file manager) for the ship's papers: statutory & class
--       certificates, insurance, manuals & plans, and anything else. Each node
--       is either a folder or a file; files carry an optional expiry date for
--       certificate-renewal tracking.
--
--       Files live in the private 'vessel-vault' bucket at {tenant}/{uuid}-name.
--       The DB row stores the object path (re-signed on display).
--
-- ACCESS: Command/Chief only — both read and write. The ship's papers are senior
--       crew's responsibility and aren't exposed to general crew (Phase 1 scope).
--
-- IDEMPOTENCY: CREATE … IF NOT EXISTS + bucket ON CONFLICT DO NOTHING +
--       DROP/CREATE POLICY. Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.vessel_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  parent_id    uuid REFERENCES public.vessel_documents(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('folder', 'file')),
  name         text NOT NULL,
  storage_path text,                     -- files only
  mime_type    text,
  size_bytes   bigint,
  expiry_date  date,                     -- files only; drives renewal status
  notes        text,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vessel_documents_tenant_parent_idx
  ON public.vessel_documents (tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS vessel_documents_expiry_idx
  ON public.vessel_documents (tenant_id, expiry_date) WHERE expiry_date IS NOT NULL;

COMMENT ON TABLE public.vessel_documents IS
  'Vessel master documents vault — a folder/file tree for ship''s papers, Command/Chief scoped.';

ALTER TABLE public.vessel_documents ENABLE ROW LEVEL SECURITY;

-- Command/Chief members of the row's tenant may read and write the vault.
DROP POLICY IF EXISTS "command_chief_manage_vessel_documents" ON public.vessel_documents;
CREATE POLICY "command_chief_manage_vessel_documents"
ON public.vessel_documents
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = vessel_documents.tenant_id
      AND tm.user_id = auth.uid()
      AND tm.active = true
      AND tm.permission_tier IN ('COMMAND', 'CHIEF')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = vessel_documents.tenant_id
      AND tm.user_id = auth.uid()
      AND tm.active = true
      AND tm.permission_tier IN ('COMMAND', 'CHIEF')
  )
);

-- ── Private vault bucket ─────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES (
  'vessel-vault',
  'vessel-vault',
  false,                       -- private; reads go through signed URLs
  52428800                     -- 50MB — manuals/plans can be large; any mime type
)
ON CONFLICT (id) DO NOTHING;

-- Objects live under {tenant_id}/… — a Command/Chief member of that tenant may
-- read and write them.
DROP POLICY IF EXISTS "command_chief_manage_vessel_vault" ON storage.objects;
CREATE POLICY "command_chief_manage_vessel_vault"
ON storage.objects
FOR ALL
TO authenticated
USING (
  bucket_id = 'vessel-vault'
  AND EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = ((storage.foldername(name))[1])::uuid
      AND tm.user_id = auth.uid()
      AND tm.active = true
      AND tm.permission_tier IN ('COMMAND', 'CHIEF')
  )
)
WITH CHECK (
  bucket_id = 'vessel-vault'
  AND EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = ((storage.foldername(name))[1])::uuid
      AND tm.user_id = auth.uid()
      AND tm.active = true
      AND tm.permission_tier IN ('COMMAND', 'CHIEF')
  )
);

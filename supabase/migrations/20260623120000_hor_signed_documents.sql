-- ─────────────────────────────────────────────────────────────────────────────
-- 20260623120000_hor_signed_documents.sql
--
-- WHAT: A retention vault for signed Records of Hours of Rest. When a crew
--       member's month becomes fully signed off (crew signature + master
--       counter-signature → hor_month_status.status = 'confirmed'), the client
--       renders that seafarer's signed MLC record to PDF and files it here, in a
--       per-month folder. The vault accumulates one signed PDF per seafarer per
--       month, so a flag/PSC inspector (or the next captain) can always pull the
--       authoritative signed record back — not just whatever sat in an inbox.
--
--       Storage layout (private 'hor-documents' bucket):
--         {tenant_id}/{year}-{MM}/{subject_user_id}.pdf
--       i.e. each month is its own folder; re-signing overwrites in place.
--
--       The DB row stores the object PATH (re-signed on display, so the record
--       outlives any signed-URL expiry) plus the signed names for at-a-glance
--       listing. PK is one row per (tenant, seafarer, year, month).
--
-- IDEMPOTENCY: CREATE TABLE/POLICY IF NOT EXISTS + bucket ON CONFLICT DO NOTHING
--       + DROP/CREATE POLICY. Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── The signed-record index ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hor_signed_documents (
  tenant_id         uuid    NOT NULL,
  subject_user_id   uuid    NOT NULL,
  period_year       integer NOT NULL,
  period_month      integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  storage_path      text    NOT NULL,
  file_name         text,
  crew_signed_name  text,
  master_signed_name text,
  byte_size         bigint,
  archived_by       uuid,
  archived_at       timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, subject_user_id, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS hor_signed_documents_month_idx
  ON public.hor_signed_documents (tenant_id, period_year, period_month);

COMMENT ON TABLE public.hor_signed_documents IS
  'Vault index of signed Records of Hours of Rest — one row per seafarer per month, filed when the month is fully signed off.';

ALTER TABLE public.hor_signed_documents ENABLE ROW LEVEL SECURITY;

-- Active members of the vessel may read the vault (the captain sees the fleet's
-- signed records; crew see their vessel's). The sign-off transition that
-- triggers a write is itself gated by the hor_submit/approve RPCs, so writes are
-- allowed to any active member of the row's tenant.
DROP POLICY IF EXISTS "tenant_members_read_hor_documents" ON public.hor_signed_documents;
CREATE POLICY "tenant_members_read_hor_documents"
ON public.hor_signed_documents
FOR SELECT
TO authenticated
USING (public.is_active_tenant_member(tenant_id, auth.uid()));

DROP POLICY IF EXISTS "tenant_members_write_hor_documents" ON public.hor_signed_documents;
CREATE POLICY "tenant_members_write_hor_documents"
ON public.hor_signed_documents
FOR ALL
TO authenticated
USING (public.is_active_tenant_member(tenant_id, auth.uid()))
WITH CHECK (public.is_active_tenant_member(tenant_id, auth.uid()));

-- ── Private document bucket ──────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'hor-documents',
  'hor-documents',
  false,                       -- private; reads go through signed URLs
  10485760,                    -- 10MB — a single-seafarer signed PDF is small
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Objects live under {tenant_id}/… — an active member of that tenant may read
-- and write them (the path's first folder is the tenant id).
DROP POLICY IF EXISTS "tenant_members_manage_hor_documents" ON storage.objects;
CREATE POLICY "tenant_members_manage_hor_documents"
ON storage.objects
FOR ALL
TO authenticated
USING (
  bucket_id = 'hor-documents'
  AND public.is_active_tenant_member(((storage.foldername(name))[1])::uuid, auth.uid())
)
WITH CHECK (
  bucket_id = 'hor-documents'
  AND public.is_active_tenant_member(((storage.foldername(name))[1])::uuid, auth.uid())
);

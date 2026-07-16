-- ─────────────────────────────────────────────────────────────────────────────
-- 20260716250000_defect_documents.sql
--
-- WHAT: Attach quotes and invoices to a defect. Files live in a private,
--       tenant-scoped Storage bucket (first path segment = tenant_id, checked
--       via is_tenant_member); rows in defect_documents keep the object path
--       plus the money (amount + currency) so the repair record can show a
--       quoted-vs-invoiced cost variance.
--
-- Mirrors the laundry-photos bucket (private, is_tenant_member) and the
-- defect_comments/defect_events tenant RLS. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

-- Private bucket: PDFs + common image types, 15 MB cap.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('defect-documents', 'defect-documents', false, 15728640,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "defect_documents_read" on storage.objects;
create policy "defect_documents_read" on storage.objects for select to authenticated
using (bucket_id = 'defect-documents' and public.is_tenant_member(nullif((storage.foldername(name))[1], '')::uuid));

drop policy if exists "defect_documents_insert" on storage.objects;
create policy "defect_documents_insert" on storage.objects for insert to authenticated
with check (bucket_id = 'defect-documents' and public.is_tenant_member(nullif((storage.foldername(name))[1], '')::uuid));

drop policy if exists "defect_documents_delete" on storage.objects;
create policy "defect_documents_delete" on storage.objects for delete to authenticated
using (bucket_id = 'defect-documents' and public.is_tenant_member(nullif((storage.foldername(name))[1], '')::uuid));

-- Metadata rows.
CREATE TABLE IF NOT EXISTS public.defect_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  defect_id       uuid NOT NULL REFERENCES public.defects(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'other' CHECK (kind IN ('quote', 'invoice', 'other')),
  storage_path    text NOT NULL,
  file_name       text,
  mime_type       text,
  size_bytes      bigint,
  amount          numeric(12,2),
  currency        text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS defect_documents_defect_idx ON public.defect_documents (defect_id, created_at);

ALTER TABLE public.defect_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "defect_documents_tenant_select" ON public.defect_documents;
CREATE POLICY "defect_documents_tenant_select" ON public.defect_documents FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() AND active = true));

DROP POLICY IF EXISTS "defect_documents_tenant_insert" ON public.defect_documents;
CREATE POLICY "defect_documents_tenant_insert" ON public.defect_documents FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() AND active = true));

DROP POLICY IF EXISTS "defect_documents_tenant_delete" ON public.defect_documents;
CREATE POLICY "defect_documents_tenant_delete" ON public.defect_documents FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() AND active = true));

-- Extend personal_documents into a richer crew "Documents" record:
-- travel docs, visas, medical/safety certs, and qualifications (CoC).
-- Status (green/amber/red) is derived in the UI from expiry_date.

alter table public.personal_documents
  add column if not exists category          text,
  add column if not exists title             text,
  add column if not exists document_number   text,
  add column if not exists issuing_authority text,
  add column if not exists flag_state        text,
  add column if not exists issue_date        date,
  add column if not exists details           jsonb not null default '{}'::jsonb,
  add column if not exists file_name         text,
  add column if not exists mime_type         text,
  add column if not exists size_bytes        bigint,
  add column if not exists tenant_id         uuid,
  add column if not exists created_by        uuid,
  add column if not exists parse_status      text,
  add column if not exists parsed_fields     jsonb,
  add column if not exists updated_at        timestamptz not null default now();

-- A document record can exist without an uploaded file (manually keyed expiry).
alter table public.personal_documents alter column file_url drop not null;

create index if not exists personal_documents_user_idx   on public.personal_documents (user_id);
create index if not exists personal_documents_expiry_idx on public.personal_documents (expiry_date);
create index if not exists personal_documents_tenant_idx on public.personal_documents (tenant_id);

-- COMMAND in a shared active tenant can fully manage a crew member's
-- documents (compliance oversight + onboarding on their behalf).
-- Self-access stays covered by the existing owner ALL policy.
drop policy if exists command_reads_tenant_personal_documents on public.personal_documents;
drop policy if exists command_manages_tenant_personal_documents on public.personal_documents;
create policy command_manages_tenant_personal_documents
  on public.personal_documents for all
  using (
    exists (
      select 1
      from public.tenant_members viewer
      join public.tenant_members subject on subject.tenant_id = viewer.tenant_id
      where viewer.user_id = auth.uid()
        and viewer.active = true
        and viewer.permission_tier = 'COMMAND'
        and subject.user_id = personal_documents.user_id
    )
  )
  with check (
    exists (
      select 1
      from public.tenant_members viewer
      join public.tenant_members subject on subject.tenant_id = viewer.tenant_id
      where viewer.user_id = auth.uid()
        and viewer.active = true
        and viewer.permission_tier = 'COMMAND'
        and subject.user_id = personal_documents.user_id
    )
  );

-- Private bucket for uploaded document files (accessed via signed URLs,
-- mirroring the existing avatars flow).
insert into storage.buckets (id, name, public)
values ('crew-documents', 'crew-documents', false)
on conflict (id) do nothing;

-- Owners manage files under crew-documents/{their_uid}/...
drop policy if exists crew_docs_owner_all on storage.objects;
create policy crew_docs_owner_all on storage.objects
  for all to authenticated
  using (bucket_id = 'crew-documents' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'crew-documents' and (storage.foldername(name))[1] = auth.uid()::text);

-- COMMAND can manage files for crew in their tenant (onboarding on behalf of crew).
drop policy if exists crew_docs_command_all on storage.objects;
create policy crew_docs_command_all on storage.objects
  for all to authenticated
  using (
    bucket_id = 'crew-documents' and exists (
      select 1 from public.tenant_members v
      join public.tenant_members s on s.tenant_id = v.tenant_id
      where v.user_id = auth.uid() and v.active = true and v.permission_tier = 'COMMAND'
        and s.user_id::text = (storage.foldername(name))[1]
    )
  )
  with check (
    bucket_id = 'crew-documents' and exists (
      select 1 from public.tenant_members v
      join public.tenant_members s on s.tenant_id = v.tenant_id
      where v.user_id = auth.uid() and v.active = true and v.permission_tier = 'COMMAND'
        and s.user_id::text = (storage.foldername(name))[1]
    )
  );

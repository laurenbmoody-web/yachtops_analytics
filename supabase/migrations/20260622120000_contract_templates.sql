-- Vessel contract templates. COMMAND uploads .docx templates containing
-- {{token}} placeholders, optionally mapped to crew roles. The crew-profile
-- contract rail picks the right template for a crew member and merges their
-- profile / employment / vessel data into the tokens to generate a contract.
create table if not exists public.contract_templates (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  name         text not null,
  roles        text[] not null default '{}',   -- role names this template suits ({} = any)
  storage_path text not null,                   -- vessel-documents/{tenant}/templates/...
  file_name    text,
  mime_type    text,
  size_bytes   bigint,
  tokens       text[] not null default '{}',    -- {{tokens}} detected in the file
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists contract_templates_tenant_idx on public.contract_templates (tenant_id);

alter table public.contract_templates enable row level security;

-- Any active member of the tenant can read templates (needed to generate).
drop policy if exists contract_templates_member_read on public.contract_templates;
create policy contract_templates_member_read
  on public.contract_templates for select
  using (
    exists (
      select 1 from public.tenant_members v
      where v.user_id = auth.uid() and v.active = true
        and v.tenant_id = contract_templates.tenant_id
    )
  );

-- COMMAND manages (insert/update/delete) templates in their tenant.
drop policy if exists contract_templates_command_write on public.contract_templates;
create policy contract_templates_command_write
  on public.contract_templates for all
  using (
    exists (
      select 1 from public.tenant_members v
      where v.user_id = auth.uid() and v.active = true
        and v.permission_tier = 'COMMAND'
        and v.tenant_id = contract_templates.tenant_id
    )
  )
  with check (
    exists (
      select 1 from public.tenant_members v
      where v.user_id = auth.uid() and v.active = true
        and v.permission_tier = 'COMMAND'
        and v.tenant_id = contract_templates.tenant_id
    )
  );

-- Private bucket for template files; first path segment is the tenant id.
insert into storage.buckets (id, name, public)
values ('vessel-documents', 'vessel-documents', false)
on conflict (id) do nothing;

-- Members of the tenant can read their template files (to generate).
drop policy if exists vessel_docs_member_read on storage.objects;
create policy vessel_docs_member_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vessel-documents' and exists (
      select 1 from public.tenant_members v
      where v.user_id = auth.uid() and v.active = true
        and v.tenant_id::text = (storage.foldername(name))[1]
    )
  );

-- COMMAND uploads / replaces / removes template files in their tenant.
drop policy if exists vessel_docs_command_write on storage.objects;
create policy vessel_docs_command_write on storage.objects
  for all to authenticated
  using (
    bucket_id = 'vessel-documents' and exists (
      select 1 from public.tenant_members v
      where v.user_id = auth.uid() and v.active = true and v.permission_tier = 'COMMAND'
        and v.tenant_id::text = (storage.foldername(name))[1]
    )
  )
  with check (
    bucket_id = 'vessel-documents' and exists (
      select 1 from public.tenant_members v
      where v.user_id = auth.uid() and v.active = true and v.permission_tier = 'COMMAND'
        and v.tenant_id::text = (storage.foldername(name))[1]
    )
  );

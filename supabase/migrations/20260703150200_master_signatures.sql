-- Master signature & stamp, saved once per user and reused on crew lists (and
-- any future master-signed document). A captain uploads their signature and
-- stamp once; generating a crew list then just applies them.
--
-- Mirrors the hor-signatures model: a private bucket where each user writes into
-- their own {auth.uid()}/ folder, and fellow active tenant members may read
-- (so whoever generates a crew list can apply the master's stamp).

create table if not exists public.master_signatures (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  tenant_id      uuid,
  signature_path text,   -- path in master-signatures bucket (drawn/scanned signature PNG)
  stamp_path     text,   -- path in master-signatures bucket (ship's/official stamp)
  updated_at     timestamptz not null default now()
);

comment on table public.master_signatures is
  'Per-user saved signature + stamp images (paths in the master-signatures bucket), reused when signing crew lists and other master-signed documents.';

alter table public.master_signatures enable row level security;

-- Owner manages their own row.
drop policy if exists master_signatures_own on public.master_signatures;
create policy master_signatures_own on public.master_signatures for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Active fellow tenant members may read a member's row (to apply their stamp).
drop policy if exists master_signatures_tenant_read on public.master_signatures;
create policy master_signatures_tenant_read on public.master_signatures for select
  to authenticated
  using (
    exists (
      select 1 from public.tenant_members tm1
      join public.tenant_members tm2 on tm1.tenant_id = tm2.tenant_id
      where tm1.user_id = auth.uid()
        and tm2.user_id = master_signatures.user_id
        and tm1.active = true
        and tm2.active = true
    )
  );

-- ── Private bucket (signature + stamp PNG/JPEG) ──────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'master-signatures', 'master-signatures', false,
  2097152,                                    -- 2MB — signature/stamp images
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- Each user writes into their own {auth.uid()}/ folder.
drop policy if exists "users_manage_own_master_signatures" on storage.objects;
create policy "users_manage_own_master_signatures"
on storage.objects for all to authenticated
using (
  bucket_id = 'master-signatures'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'master-signatures'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Fellow active tenant members may view the images.
drop policy if exists "users_view_tenant_master_signatures" on storage.objects;
create policy "users_view_tenant_master_signatures"
on storage.objects for select to authenticated
using (
  bucket_id = 'master-signatures'
  and exists (
    select 1 from public.tenant_members tm1
    join public.tenant_members tm2 on tm1.tenant_id = tm2.tenant_id
    where tm1.user_id = auth.uid()
      and tm2.user_id = (storage.foldername(name))[1]::uuid
      and tm1.active = true
      and tm2.active = true
  )
);

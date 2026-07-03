-- Captain's own signature + vessel stamp, saved privately for producing
-- documents he signs off (contracts, discharge paperwork, etc.). Strictly
-- self-service: only the owning user can read or write their own row —
-- not even other COMMAND-tier crew, matching "his account only".
create table if not exists public.captain_credentials (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  tenant_id      uuid not null,
  signature_path text,
  stamp_path     text,
  updated_at     timestamptz not null default now()
);

alter table public.captain_credentials enable row level security;

grant select, insert, update, delete on public.captain_credentials to authenticated;

drop policy if exists captain_credentials_owner_all on public.captain_credentials;
create policy captain_credentials_owner_all on public.captain_credentials
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('captain-credentials', 'captain-credentials', false, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

-- Each user writes only into their OWN {auth.uid()}/ folder, and only they
-- can ever read it back (signed URLs, generated on demand by the owner).
drop policy if exists captain_credentials_owner_storage on storage.objects;
create policy captain_credentials_owner_storage on storage.objects
  for all to authenticated
  using (bucket_id = 'captain-credentials' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'captain-credentials' and (storage.foldername(name))[1] = auth.uid()::text);

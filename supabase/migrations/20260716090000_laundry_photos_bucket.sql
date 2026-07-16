-- Laundry photos move out of the DB (base64) into a private Storage bucket.
-- Rows keep only the object path; files live in cheap object storage. Access is
-- tenant-scoped: the first path segment is the tenant_id, checked via
-- is_tenant_member (SECURITY DEFINER). Idempotent.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('laundry-photos', 'laundry-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "laundry_photos_read" on storage.objects;
create policy "laundry_photos_read" on storage.objects for select to authenticated
using (bucket_id = 'laundry-photos' and public.is_tenant_member(nullif((storage.foldername(name))[1], '')::uuid));

drop policy if exists "laundry_photos_insert" on storage.objects;
create policy "laundry_photos_insert" on storage.objects for insert to authenticated
with check (bucket_id = 'laundry-photos' and public.is_tenant_member(nullif((storage.foldername(name))[1], '')::uuid));

drop policy if exists "laundry_photos_delete" on storage.objects;
create policy "laundry_photos_delete" on storage.objects for delete to authenticated
using (bucket_id = 'laundry-photos' and public.is_tenant_member(nullif((storage.foldername(name))[1], '')::uuid));

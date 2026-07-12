-- Certifications become records that can carry a document + a verified tick,
-- instead of bare text labels. A public bucket holds the certificate files
-- (a cert is proof a supplier wants shown); supplier_profiles.certifications
-- stays in sync (names only) so the buyer storefront is unchanged.

-- ── Bucket for certificate documents ─────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('supplier-certs', 'supplier-certs', true, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- A supplier manages files under their own supplier-id folder.
drop policy if exists "supplier_manage_own_certs" on storage.objects;
create policy "supplier_manage_own_certs" on storage.objects
  for all to authenticated
  using (bucket_id = 'supplier-certs' and (storage.foldername(name))[1] = public.get_user_supplier_id()::text)
  with check (bucket_id = 'supplier-certs' and (storage.foldername(name))[1] = public.get_user_supplier_id()::text);

-- ── Certifications table ─────────────────────────────────────────────
create table if not exists public.supplier_certifications (
  id          uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.supplier_profiles(id) on delete cascade,
  name        text not null,
  doc_url     text,
  verified    boolean not null default false,
  verified_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (supplier_id, name)
);
alter table public.supplier_certifications enable row level security;

drop policy if exists sc_select_own on public.supplier_certifications;
create policy sc_select_own on public.supplier_certifications
  for select to authenticated using (supplier_id = public.get_user_supplier_id());

-- Migrate existing text[] labels into rows (names only).
insert into public.supplier_certifications (supplier_id, name)
select sp.id, btrim(c)
from public.supplier_profiles sp, unnest(sp.certifications) as c
where coalesce(array_length(sp.certifications, 1), 0) > 0 and btrim(c) <> ''
on conflict (supplier_id, name) do nothing;

-- ── Read: the caller's certifications ────────────────────────────────
create or replace function public.get_my_certifications()
returns table (id uuid, name text, doc_url text, verified boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.doc_url, c.verified
  from public.supplier_certifications c
  where c.supplier_id = public.get_user_supplier_id()
  order by c.name;
$$;
grant execute on function public.get_my_certifications() to authenticated;

-- ── Write: replace the caller's cert set (preserving verified for kept
--    names) and keep supplier_profiles.certifications (names) in sync. ──
create or replace function public.save_my_certifications(p_certs jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_supplier uuid; v_names text[];
begin
  v_supplier := public.get_user_supplier_id();
  if v_supplier is null then
    raise exception 'not a supplier user';
  end if;

  insert into public.supplier_certifications (supplier_id, name, doc_url)
  select v_supplier, btrim(e->>'name'), nullif(btrim(coalesce(e->>'doc_url', '')), '')
  from jsonb_array_elements(coalesce(p_certs, '[]'::jsonb)) e
  where btrim(coalesce(e->>'name', '')) <> ''
  on conflict (supplier_id, name) do update set doc_url = excluded.doc_url;

  select array_agg(btrim(e->>'name')) into v_names
  from jsonb_array_elements(coalesce(p_certs, '[]'::jsonb)) e
  where btrim(coalesce(e->>'name', '')) <> '';

  delete from public.supplier_certifications
  where supplier_id = v_supplier and (v_names is null or name <> all(v_names));

  update public.supplier_profiles
     set certifications = coalesce(v_names, '{}')
   where id = v_supplier;
end;
$$;
grant execute on function public.save_my_certifications(jsonb) to authenticated;

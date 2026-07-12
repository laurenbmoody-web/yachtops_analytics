-- Expiry now carries weight. An expired certificate stops counting as
-- "verified" to buyers (a stale Verified tick is worse than none), and the
-- supplier can see each cert's expiry in their own settings.

-- Buyers: verified AND not lapsed.
create or replace function public.get_supplier_verified_certs(p_supplier_id uuid)
returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(name order by name), '{}')
  from public.supplier_certifications
  where supplier_id = p_supplier_id
    and verified = true
    and (expiry_date is null or expiry_date >= current_date);
$$;
grant execute on function public.get_supplier_verified_certs(uuid) to authenticated;

-- Supplier's own list now carries expiry + status (return shape change → recreate).
drop function if exists public.get_my_certifications();
create or replace function public.get_my_certifications()
returns table (id uuid, name text, doc_url text, verified boolean, expiry_date date, status text)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.doc_url, c.verified, c.expiry_date, c.status
  from public.supplier_certifications c
  where c.supplier_id = public.get_user_supplier_id()
  order by c.name;
$$;
grant execute on function public.get_my_certifications() to authenticated;

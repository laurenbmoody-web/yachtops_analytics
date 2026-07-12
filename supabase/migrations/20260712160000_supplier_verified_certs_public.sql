-- Buyers need to see WHICH of a supplier's certifications Cargo has verified,
-- so the marketplace can show the Verified tick. supplier_certifications RLS
-- only lets the owner read their rows; this SECURITY DEFINER RPC exposes just
-- the verified names (public trust info) to any signed-in buyer.

create or replace function public.get_supplier_verified_certs(p_supplier_id uuid)
returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(name order by name), '{}')
  from public.supplier_certifications
  where supplier_id = p_supplier_id and verified = true;
$$;
grant execute on function public.get_supplier_verified_certs(uuid) to authenticated;

-- Marketplace visibility fix: tenant_id was the wrong criterion.
--
-- supplier_profiles.tenant_id records which tenant added the row to
-- their vendor directory — a supplier claimed as a vendor by one yacht
-- (e.g. Source and Supply) still runs a real portal account and must
-- appear in the marketplace. The honest definition of a marketplace
-- supplier is "has an active portal team": at least one active
-- supplier_contacts row bound to a real auth user. Directory-only
-- vendor entries (no portal team) stay invisible, which also keeps
-- one tenant's private vendors out of another tenant's marketplace.

create or replace function public.get_marketplace_suppliers()
returns table (
  id              uuid,
  name            text,
  description     text,
  logo_url        text,
  coverage_ports  text[],
  categories      text[],
  verified        boolean,
  business_city   text,
  business_country text,
  catalogue_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    sp.id,
    sp.name,
    sp.description,
    sp.logo_url,
    sp.coverage_ports,
    sp.categories,
    sp.verified,
    sp.business_city,
    sp.business_country,
    count(ci.id) as catalogue_count
  from public.supplier_profiles sp
  join public.supplier_catalogue_items ci
    on ci.supplier_id = sp.id and ci.active = true
  where sp.archived_at is null
    -- A real Cargo supplier: an active portal team member exists.
    and exists (
      select 1 from public.supplier_contacts sc
      where sc.supplier_id = sp.id
        and sc.active = true
        and sc.user_id is not null
    )
    -- Caller must be an active crew member somewhere.
    and exists (
      select 1 from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true
    )
  group by sp.id
  order by sp.verified desc, count(ci.id) desc, sp.name asc;
$$;

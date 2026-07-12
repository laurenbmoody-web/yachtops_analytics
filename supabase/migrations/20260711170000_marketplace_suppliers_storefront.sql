-- Surface the storefront operational fields (lead time, cut-off, minimum,
-- certifications, express) on the marketplace RPC so buyers see them on the
-- deck card + aisle header. Return shape changes, so drop + recreate.

drop function if exists public.get_marketplace_suppliers();

create function public.get_marketplace_suppliers()
returns table (
  id                 uuid,
  name               text,
  description        text,
  logo_url           text,
  coverage_ports     text[],
  categories         text[],
  verified           boolean,
  business_city      text,
  business_country   text,
  service_radius_km  integer,
  catalogue_count    bigint,
  lead_time_days     integer,
  order_cutoff       time,
  min_order_value    numeric,
  min_order_currency text,
  certifications     text[],
  express_available  boolean
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
    sp.service_radius_km,
    count(ci.id) as catalogue_count,
    sp.lead_time_days,
    sp.order_cutoff,
    sp.min_order_value,
    sp.min_order_currency,
    sp.certifications,
    sp.express_available
  from public.supplier_profiles sp
  join public.supplier_catalogue_items ci
    on ci.supplier_id = sp.id and ci.active = true
  where sp.archived_at is null
    and exists (
      select 1 from public.supplier_contacts sc
      where sc.supplier_id = sp.id
        and sc.active = true
        and sc.user_id is not null
    )
    and exists (
      select 1 from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true
    )
  group by sp.id
  order by sp.verified desc, count(ci.id) desc, sp.name asc;
$$;

grant execute on function public.get_marketplace_suppliers() to authenticated;

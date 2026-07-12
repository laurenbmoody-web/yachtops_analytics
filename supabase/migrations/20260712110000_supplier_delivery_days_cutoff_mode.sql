-- Delivery days + strict/flexible cut-off for the supplier storefront.
--   delivery_days: which weekdays the supplier runs deliveries.
--   cutoff_strict: true = the cut-off is firm (blocks next delivery cycle);
--                  false = flexible ("we'll try, may not make it").
-- Both surface to buyers and feed the storefront preview.

alter table public.supplier_profiles
  add column if not exists delivery_days text[] default '{}',
  add column if not exists cutoff_strict boolean default false;

-- Extend the storefront write RPC (return-shape / arg-list change → recreate).
drop function if exists public.update_supplier_storefront(integer, time, numeric, text, text[], boolean);
create or replace function public.update_supplier_storefront(
  p_lead_time_days     integer,
  p_order_cutoff       time,
  p_min_order_value    numeric,
  p_min_order_currency text,
  p_certifications     text[],
  p_express_available  boolean,
  p_delivery_days      text[]  default '{}',
  p_cutoff_strict      boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_supplier uuid;
begin
  v_supplier := public.get_user_supplier_id();
  if v_supplier is null then
    raise exception 'not a supplier user';
  end if;

  update public.supplier_profiles
     set lead_time_days     = p_lead_time_days,
         order_cutoff       = p_order_cutoff,
         min_order_value    = p_min_order_value,
         min_order_currency = coalesce(nullif(btrim(coalesce(p_min_order_currency, '')), ''), 'EUR'),
         certifications     = coalesce(p_certifications, '{}'),
         express_available  = coalesce(p_express_available, false),
         delivery_days      = coalesce(p_delivery_days, '{}'),
         cutoff_strict      = coalesce(p_cutoff_strict, false)
   where id = v_supplier;
end;
$$;
grant execute on function public.update_supplier_storefront(integer, time, numeric, text, text[], boolean, text[], boolean) to authenticated;

-- Extend the marketplace RPC so buyers get the new fields.
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
  express_available  boolean,
  delivery_days      text[],
  cutoff_strict      boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    sp.id, sp.name, sp.description, sp.logo_url, sp.coverage_ports, sp.categories,
    sp.verified, sp.business_city, sp.business_country, sp.service_radius_km,
    count(ci.id) as catalogue_count,
    sp.lead_time_days, sp.order_cutoff, sp.min_order_value, sp.min_order_currency,
    sp.certifications, sp.express_available, sp.delivery_days, sp.cutoff_strict
  from public.supplier_profiles sp
  join public.supplier_catalogue_items ci
    on ci.supplier_id = sp.id and ci.active = true
  where sp.archived_at is null
    and exists (
      select 1 from public.supplier_contacts sc
      where sc.supplier_id = sp.id and sc.active = true and sc.user_id is not null
    )
    and exists (
      select 1 from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true
    )
  group by sp.id
  order by sp.verified desc, count(ci.id) desc, sp.name asc;
$$;
grant execute on function public.get_marketplace_suppliers() to authenticated;

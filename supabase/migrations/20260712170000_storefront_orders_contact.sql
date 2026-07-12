-- An explicit "who to contact for orders" on the storefront. A supplier's
-- company-profile email/phone may not be the channel they want yachts using,
-- so this is a separate, supplier-set contact shown on the marketplace card.
-- Also restores website + contact_* to get_marketplace_suppliers, which were
-- dropped when the RPC was recreated for delivery-days (20260712110000).

alter table public.supplier_profiles
  add column if not exists storefront_contact_name  text,
  add column if not exists storefront_contact_role  text,
  add column if not exists storefront_contact_email text,
  add column if not exists storefront_contact_phone text;

-- ── Storefront write RPC: +4 contact args (arg-list change → recreate) ──
drop function if exists public.update_supplier_storefront(integer, time, numeric, text, text[], boolean, text[], boolean);
create or replace function public.update_supplier_storefront(
  p_lead_time_days     integer,
  p_order_cutoff       time,
  p_min_order_value    numeric,
  p_min_order_currency text,
  p_certifications     text[],
  p_express_available  boolean,
  p_delivery_days      text[]  default '{}',
  p_cutoff_strict      boolean default false,
  p_contact_name       text default null,
  p_contact_role       text default null,
  p_contact_email      text default null,
  p_contact_phone      text default null)
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
         cutoff_strict      = coalesce(p_cutoff_strict, false),
         storefront_contact_name  = nullif(btrim(coalesce(p_contact_name, '')), ''),
         storefront_contact_role  = nullif(btrim(coalesce(p_contact_role, '')), ''),
         storefront_contact_email = nullif(btrim(coalesce(p_contact_email, '')), ''),
         storefront_contact_phone = nullif(btrim(coalesce(p_contact_phone, '')), '')
   where id = v_supplier;
end;
$$;
grant execute on function public.update_supplier_storefront(integer, time, numeric, text, text[], boolean, text[], boolean, text, text, text, text) to authenticated;

-- ── Marketplace RPC: restore website + contact_* (from the explicit
--    storefront contact) alongside the storefront terms. ──
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
  website            text,
  contact_name       text,
  contact_role       text,
  contact_email      text,
  contact_phone      text,
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
    nullif(sp.website, '')       as website,
    sp.storefront_contact_name   as contact_name,
    sp.storefront_contact_role   as contact_role,
    sp.storefront_contact_email  as contact_email,
    sp.storefront_contact_phone  as contact_phone,
    count(ci.id)                 as catalogue_count,
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

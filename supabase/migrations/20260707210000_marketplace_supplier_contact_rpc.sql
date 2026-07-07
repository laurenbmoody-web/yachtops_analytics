-- Extend the marketplace storefront RPC with the supplier's public
-- contact — the person you'd actually reach, from their portal team —
-- plus website. Return shape changes, so drop + recreate.
--
-- Primary contact: the active, real (user-linked) portal member who can
-- confirm orders, earliest joined. Phone/email fall back to the profile's
-- own contact fields when the person hasn't set their own.

drop function if exists public.get_marketplace_suppliers();

create function public.get_marketplace_suppliers()
returns table (
  id                uuid,
  name              text,
  description       text,
  logo_url          text,
  coverage_ports    text[],
  categories        text[],
  verified          boolean,
  business_city     text,
  business_country  text,
  service_radius_km integer,
  website           text,
  contact_name      text,
  contact_role      text,
  contact_email     text,
  contact_phone     text,
  catalogue_count   bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    sp.id, sp.name, sp.description, sp.logo_url, sp.coverage_ports, sp.categories,
    sp.verified, sp.business_city, sp.business_country, sp.service_radius_km,
    nullif(sp.website, '')                                   as website,
    c.name                                                  as contact_name,
    c.role                                                  as contact_role,
    coalesce(nullif(c.email, ''), nullif(sp.contact_email, '')) as contact_email,
    coalesce(nullif(c.phone, ''), nullif(sp.contact_phone, '')) as contact_phone,
    count(ci.id)                                            as catalogue_count
  from public.supplier_profiles sp
  join public.supplier_catalogue_items ci
    on ci.supplier_id = sp.id and ci.active = true
  left join lateral (
    select sc.name, sc.role, sc.email, sc.phone
    from public.supplier_contacts sc
    where sc.supplier_id = sp.id and sc.active = true and sc.user_id is not null
    order by sc.can_confirm_orders desc nulls last, sc.created_at asc
    limit 1
  ) c on true
  where sp.archived_at is null
    and exists (
      select 1 from public.supplier_contacts sc
      where sc.supplier_id = sp.id and sc.active = true and sc.user_id is not null
    )
    and exists (
      select 1 from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true
    )
  group by sp.id, c.name, c.role, c.email, c.phone
  order by sp.verified desc, count(ci.id) desc, sp.name asc;
$$;

grant execute on function public.get_marketplace_suppliers() to authenticated;

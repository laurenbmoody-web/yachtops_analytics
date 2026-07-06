-- Marketplace Phase 2 — crew-safe supplier discovery.
--
-- crew_read_supplier_profiles (20260515120000) deliberately scopes crew
-- SELECTs to their own tenant's vendor rows, so portal/marketplace
-- suppliers (tenant_id IS NULL, e.g. self-signed-up provisioners) are
-- invisible to yachts. The marketplace needs them visible — but the raw
-- row carries bank_details, VAT numbers and invoice settings that crew
-- must never see. So: a SECURITY DEFINER RPC that returns only the
-- public storefront columns, only for marketplace suppliers that
-- actually have something to sell.

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
  where sp.tenant_id is null
    and sp.archived_at is null
    -- Caller must be an active crew member somewhere; anonymous or
    -- supplier-only accounts get nothing.
    and exists (
      select 1 from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true
    )
  group by sp.id
  order by sp.verified desc, count(ci.id) desc, sp.name asc;
$$;

grant execute on function public.get_marketplace_suppliers() to authenticated;
revoke execute on function public.get_marketplace_suppliers() from anon;

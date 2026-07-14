-- Vessel logos for the supplier messaging inbox.
--
-- vessels.logo_url is readable only by that vessel's own tenant members (RLS),
-- so a supplier can't select it directly. This SECURITY DEFINER function hands
-- back logo_url per tenant, scoped to just the vessels the calling supplier
-- already has a message thread with — no broader exposure of the vessels table.

create or replace function public.supplier_vessel_logos()
returns table (tenant_id uuid, logo_url text)
language sql
security definer
set search_path = public
stable
as $$
  select v.tenant_id, v.logo_url
  from public.vessels v
  where v.logo_url is not null
    and v.tenant_id in (
      select t.tenant_id
      from public.supplier_message_threads t
      where t.supplier_id = get_user_supplier_id()
    );
$$;

grant execute on function public.supplier_vessel_logos() to authenticated;

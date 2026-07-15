-- Broaden supplier_vessel_logos to cover every vessel the supplier relates to,
-- not just those with a message thread — so the vessel's logo can be its avatar
-- everywhere on the supplier side (clients list, client profile, inbox).
--
-- Still scoped by get_user_supplier_id(): a supplier only ever sees logos for
-- vessels that are their client (tenant_suppliers) or that they message.

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
      select ts.tenant_id from public.tenant_suppliers ts where ts.supplier_id = get_user_supplier_id()
      union
      select t.tenant_id  from public.supplier_message_threads t where t.supplier_id = get_user_supplier_id()
    );
$$;

grant execute on function public.supplier_vessel_logos() to authenticated;

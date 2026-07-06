-- Which of these suppliers run a live Cargo portal? Crew can't read
-- supplier_contacts (supplier-side RLS), so the send flow asks via a
-- SECURITY DEFINER RPC that returns ids only — no team details leak.
-- Used by SendToSupplierModal to offer the express "Send to portal"
-- path instead of the email/WhatsApp form.

create or replace function public.get_portal_supplier_ids(p_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct sc.supplier_id
  from public.supplier_contacts sc
  where sc.supplier_id = any(p_ids)
    and sc.active = true
    and sc.user_id is not null
    and exists (
      select 1 from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true
    );
$$;

grant execute on function public.get_portal_supplier_ids(uuid[]) to authenticated;
revoke execute on function public.get_portal_supplier_ids(uuid[]) from anon;

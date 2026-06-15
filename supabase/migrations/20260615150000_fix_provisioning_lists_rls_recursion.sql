-- Fix infinite recursion in provisioning_lists RLS introduced by
-- 20260615130000_enable_rls_four_exposed_tables.sql.
--
-- The chain:
--   • provisioning_lists SELECT policy (from 20260330120000) queries
--     provisioning_list_collaborators to surface shared boards.
--   • provisioning_list_collaborators SELECT policy (from today's
--     migration) queries provisioning_lists to scope to the user's
--     tenant.
--   • Each policy triggers the other's evaluation → infinite recursion.
--     Postgres aborts with "infinite recursion detected in policy for
--     relation 'provisioning_lists'" and the whole provisioning page
--     fails to load.
--
-- Fix: break the chain with a SECURITY DEFINER helper that fetches
-- provisioning_lists.tenant_id WITHOUT triggering RLS on that table.
-- The collaborator + shares policies then call the helper instead of
-- joining provisioning_lists directly.
--
-- Security: helper only returns tenant_id (not list contents), and the
-- policies still require an active tenant_members membership match, so
-- there's no widening of access. Behaviour matches the intent of the
-- enable_rls migration; only the implementation changes.

create or replace function public.provisioning_list_tenant(p_list_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select tenant_id from public.provisioning_lists where id = p_list_id
$$;

grant execute on function public.provisioning_list_tenant(uuid) to authenticated;

-- ── provisioning_list_shares — rewrite without joining provisioning_lists ──
drop policy if exists provisioning_list_shares_all on public.provisioning_list_shares;
create policy provisioning_list_shares_all on public.provisioning_list_shares for all
  using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = public.provisioning_list_tenant(provisioning_list_shares.list_id)
      and tm.user_id = auth.uid()
      and tm.active
  ))
  with check (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = public.provisioning_list_tenant(provisioning_list_shares.list_id)
      and tm.user_id = auth.uid()
      and tm.active
  ));

-- ── provisioning_list_collaborators — same rewrite ──
drop policy if exists provisioning_list_collaborators_select on public.provisioning_list_collaborators;
create policy provisioning_list_collaborators_select on public.provisioning_list_collaborators for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.tenant_members tm
      where tm.tenant_id = public.provisioning_list_tenant(provisioning_list_collaborators.list_id)
        and tm.user_id = auth.uid()
        and tm.active
    )
  );

drop policy if exists provisioning_list_collaborators_write on public.provisioning_list_collaborators;
create policy provisioning_list_collaborators_write on public.provisioning_list_collaborators for all
  using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = public.provisioning_list_tenant(provisioning_list_collaborators.list_id)
      and tm.user_id = auth.uid()
      and tm.active
  ))
  with check (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = public.provisioning_list_tenant(provisioning_list_collaborators.list_id)
      and tm.user_id = auth.uid()
      and tm.active
  ));

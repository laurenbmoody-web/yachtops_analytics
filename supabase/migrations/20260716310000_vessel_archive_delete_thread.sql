-- Let the vessel (crew) archive and delete their supplier conversations, like
-- the supplier already can. Tenant members only have SELECT on
-- supplier_message_threads, so these go through SECURITY DEFINER RPCs gated to
-- active members of the thread's tenant. Delete cascades to the thread's
-- messages (FK on delete cascade) — it removes the conversation for both sides,
-- matching the supplier-side delete.

create or replace function public.set_thread_archived_vessel(p_thread_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.supplier_message_threads where id = p_thread_id;
  if v_tenant is null then raise exception 'thread not found'; end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = v_tenant and tm.user_id = auth.uid() and tm.status <> 'invited'
  ) then
    raise exception 'not authorized';
  end if;

  update public.supplier_message_threads
     set archived_at = case when p_archived then now() else null end
   where id = p_thread_id;
end $$;

create or replace function public.delete_thread_vessel(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.supplier_message_threads where id = p_thread_id;
  if v_tenant is null then raise exception 'thread not found'; end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = v_tenant and tm.user_id = auth.uid() and tm.status <> 'invited'
  ) then
    raise exception 'not authorized';
  end if;

  delete from public.supplier_message_threads where id = p_thread_id;
end $$;

grant execute on function public.set_thread_archived_vessel(uuid, boolean) to authenticated;
grant execute on function public.delete_thread_vessel(uuid) to authenticated;

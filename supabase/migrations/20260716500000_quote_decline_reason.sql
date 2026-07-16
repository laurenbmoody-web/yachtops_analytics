-- Capture a reason when the crew decline a supplier's quote, and carry it back
-- to the supplier so their "Revise & re-quote" is informed instead of guesswork.
--
-- The reason lives on the declined quote message (quote_decline_reason) and is
-- echoed into the system line the supplier sees in the thread. The RPC gains an
-- optional p_reason; the old single-arg signature is dropped so calling with
-- just p_message_id resolves unambiguously to the new default-arg version.

alter table public.supplier_messages
  add column if not exists quote_decline_reason text;

drop function if exists public.decline_supplier_quote(uuid);

create or replace function public.decline_supplier_quote(p_message_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread uuid;
  v_tenant uuid;
  v_reason text := nullif(btrim(p_reason), '');
begin
  select m.thread_id into v_thread
  from public.supplier_messages m
  where m.id = p_message_id and m.kind = 'quote' and coalesce(m.quote_status, 'pending') = 'pending';
  if v_thread is null then raise exception 'quote not found or already resolved'; end if;

  select t.tenant_id into v_tenant from public.supplier_message_threads t where t.id = v_thread;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = v_tenant and tm.user_id = auth.uid() and tm.status <> 'invited'
  ) then
    raise exception 'not authorized';
  end if;

  update public.supplier_messages
     set quote_status = 'declined', quote_resolved_at = now(), quote_resolved_by = auth.uid(),
         quote_decline_reason = v_reason
   where id = p_message_id;

  insert into public.supplier_messages (thread_id, sender_type, sender_user_id, body, kind)
  values (v_thread, 'vessel', auth.uid(),
          'Quote declined' || case when v_reason is not null then ' — ' || v_reason else '' end,
          'system');
end $$;

grant execute on function public.decline_supplier_quote(uuid, text) to authenticated;

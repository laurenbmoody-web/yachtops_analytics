-- Let a supplier add prices to a quote they already sent (e.g. after sourcing a
-- bespoke item) and re-send it, without starting a new quote. Only the supplier
-- side can reprice, and only while the quote is still pending. A short system
-- note bumps the thread so the vessel is nudged that pricing has arrived.
-- Reuses message_thread_role from 20260715223000.

create or replace function public.reprice_supplier_quote(p_message_id uuid, p_quote jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread uuid;
  v_kind   text;
  v_status text;
  v_role   text;
begin
  select m.thread_id, m.kind, m.quote_status
    into v_thread, v_kind, v_status
  from public.supplier_messages m
  where m.id = p_message_id;

  if v_thread is null then raise exception 'message not found'; end if;
  if v_kind <> 'quote' then raise exception 'not a quote'; end if;
  if coalesce(v_status, 'pending') <> 'pending' then raise exception 'quote already resolved'; end if;

  v_role := public.message_thread_role(v_thread);
  if v_role <> 'supplier' then raise exception 'only the supplier can reprice a quote'; end if;

  update public.supplier_messages
     set quote = p_quote, edited_at = now()
   where id = p_message_id;

  insert into public.supplier_messages (thread_id, sender_type, sender_user_id, body, kind)
  values (v_thread, 'supplier', auth.uid(), 'Updated the quote with pricing — ready to accept.', 'system');
end $$;

grant execute on function public.reprice_supplier_quote(uuid, jsonb) to authenticated;

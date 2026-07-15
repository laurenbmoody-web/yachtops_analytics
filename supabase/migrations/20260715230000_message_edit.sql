-- Edit-your-own-message, WhatsApp style. Adds edited_at and a role-aware RPC
-- that lets only the sending side rewrite a plain text message it sent. Quote
-- and system messages, and deleted messages, can't be edited. Reuses the
-- message_thread_role helper from 20260715223000.

alter table public.supplier_messages
  add column if not exists edited_at timestamptz;

create or replace function public.edit_supplier_message(p_message_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread  uuid;
  v_sender  text;
  v_kind    text;
  v_deleted timestamptz;
  v_role    text;
  v_body    text := btrim(coalesce(p_body, ''));
begin
  if v_body = '' then raise exception 'message cannot be empty'; end if;

  select m.thread_id, m.sender_type, m.kind, m.deleted_at
    into v_thread, v_sender, v_kind, v_deleted
  from public.supplier_messages m
  where m.id = p_message_id;
  if v_thread is null then raise exception 'message not found'; end if;
  if v_deleted is not null then raise exception 'cannot edit a deleted message'; end if;
  if coalesce(v_kind, 'text') not in ('text') then raise exception 'only text messages can be edited'; end if;

  v_role := public.message_thread_role(v_thread);
  if v_sender <> v_role then raise exception 'can only edit your own messages'; end if;

  update public.supplier_messages
     set body = v_body, edited_at = now()
   where id = p_message_id;
end $$;

grant execute on function public.edit_supplier_message(uuid, text) to authenticated;

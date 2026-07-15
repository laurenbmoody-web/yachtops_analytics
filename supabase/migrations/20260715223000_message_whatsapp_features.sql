-- WhatsApp-style messaging: reply-to, emoji reactions, and delete-for-everyone.
--
-- All three live on supplier_messages so both sides (vessel + supplier) share
-- them. Reactions are a jsonb array of {emoji, by, uid, at} — one reaction per
-- user (a second emoji replaces the first, tapping the same emoji clears it).
-- Deletes are soft (deleted_at/by) so the row stays for threading + audit and
-- both sides render "message deleted". Writes go through SECURITY DEFINER RPCs
-- that resolve the caller's role from the thread, since members have no direct
-- UPDATE on the messages table.

alter table public.supplier_messages
  add column if not exists reply_to_id uuid references public.supplier_messages(id) on delete set null,
  add column if not exists reactions   jsonb not null default '[]'::jsonb,
  add column if not exists deleted_at   timestamptz,
  add column if not exists deleted_by   uuid;

-- Resolve the caller's side of a thread: 'vessel' (a tenant member) or
-- 'supplier' (the thread's supplier). Raises if the caller is neither.
create or replace function public.message_thread_role(p_thread_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant   uuid;
  v_supplier uuid;
begin
  select t.tenant_id, t.supplier_id into v_tenant, v_supplier
  from public.supplier_message_threads t
  where t.id = p_thread_id;
  if v_tenant is null then raise exception 'thread not found'; end if;

  if exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = v_tenant and tm.user_id = auth.uid() and tm.status <> 'invited'
  ) then
    return 'vessel';
  elsif public.get_user_supplier_id() = v_supplier then
    return 'supplier';
  end if;
  raise exception 'not authorized';
end $$;

-- Toggle the caller's emoji reaction on a message. One reaction per user:
-- tapping the same emoji removes it; a different emoji replaces it. Returns the
-- updated reactions array.
create or replace function public.react_to_message(p_message_id uuid, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread    uuid;
  v_role      text;
  v_reactions jsonb;
  v_had_same  boolean;
  v_new       jsonb;
  v_uid       text := auth.uid()::text;
begin
  select m.thread_id, coalesce(m.reactions, '[]'::jsonb)
    into v_thread, v_reactions
  from public.supplier_messages m
  where m.id = p_message_id;
  if v_thread is null then raise exception 'message not found'; end if;

  v_role := public.message_thread_role(v_thread);

  select exists (
    select 1 from jsonb_array_elements(v_reactions) e
    where e->>'uid' = v_uid and e->>'emoji' = p_emoji
  ) into v_had_same;

  -- drop every reaction this user had (one-per-user model)
  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_new
  from jsonb_array_elements(v_reactions) e
  where e->>'uid' <> v_uid;

  if not v_had_same then
    v_new := v_new || jsonb_build_object(
      'emoji', p_emoji, 'by', v_role, 'uid', v_uid, 'at', now()
    );
  end if;

  update public.supplier_messages set reactions = v_new where id = p_message_id;
  return v_new;
end $$;

-- Delete-for-everyone: only the sending side can delete its own message. Soft
-- delete keeps the row so replies pointing at it still resolve.
create or replace function public.delete_supplier_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread uuid;
  v_sender text;
  v_role   text;
begin
  select m.thread_id, m.sender_type into v_thread, v_sender
  from public.supplier_messages m
  where m.id = p_message_id;
  if v_thread is null then raise exception 'message not found'; end if;

  v_role := public.message_thread_role(v_thread);
  if v_sender <> v_role then raise exception 'can only delete your own messages'; end if;

  update public.supplier_messages
     set deleted_at = now(), deleted_by = auth.uid()
   where id = p_message_id;
end $$;

grant execute on function public.message_thread_role(uuid) to authenticated;
grant execute on function public.react_to_message(uuid, text) to authenticated;
grant execute on function public.delete_supplier_message(uuid) to authenticated;

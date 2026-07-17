-- Supplier-side group management: pull a colleague into a thread, and keep
-- removals to your own side.
--
--   * fetch_addable_supplier_for_thread — the supplier's teammates (with a
--     login) not already in the thread, for the supplier "+" picker.
--   * remove_thread_participant — re-emitted with a SAME-SIDE guard: you may
--     only remove people on your own party (crew remove crew, supplier remove
--     supplier); anyone can remove themselves (leave). Keeps the change-line.

create or replace function public.fetch_addable_supplier_for_thread(p_thread_id uuid)
returns table (user_id uuid, name text, role text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_supplier uuid;
begin
  if not public.is_thread_participant(p_thread_id, auth.uid()) then
    raise exception 'not a participant of this thread';
  end if;
  select supplier_id into v_supplier
  from public.supplier_message_threads where id = p_thread_id;

  return query
    select sc.user_id,
           coalesce(nullif(sc.name, ''), initcap(sc.role)),
           sc.role
    from public.supplier_contacts sc
    where sc.supplier_id = v_supplier
      and sc.user_id is not null
      and not exists (
        select 1 from public.supplier_message_thread_participants p
        where p.thread_id = p_thread_id and p.user_id = sc.user_id
      )
    order by (sc.role = 'owner') desc, coalesce(nullif(sc.name, ''), sc.role);
end $$;

grant execute on function public.fetch_addable_supplier_for_thread(uuid) to authenticated;

create or replace function public.remove_thread_participant(
  p_thread  uuid,
  p_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_party        text;
  v_target_party text;
  v_stype        text;
  v_actor        text;
  v_target       text;
begin
  if not public.is_thread_participant(p_thread, v_uid) then
    raise exception 'not a participant of this thread';
  end if;

  select party into v_party
  from public.supplier_message_thread_participants
  where thread_id = p_thread and user_id = v_uid limit 1;
  select party into v_target_party
  from public.supplier_message_thread_participants
  where thread_id = p_thread and user_id = p_user_id limit 1;

  -- You can only remove people on your own side (or leave yourself).
  if p_user_id <> v_uid
     and v_party is not null and v_target_party is not null
     and v_target_party <> v_party then
    raise exception 'you can only remove people on your own side';
  end if;

  v_stype  := case when v_party = 'crew' then 'vessel' else 'supplier' end;
  v_actor  := public.thread_display_name(p_thread, v_uid);
  v_target := public.thread_display_name(p_thread, p_user_id);

  delete from public.supplier_message_thread_participants
  where thread_id = p_thread and user_id = p_user_id;

  if found then
    insert into public.supplier_messages (thread_id, sender_type, sender_user_id, body, kind)
    values (p_thread, v_stype, v_uid,
            case when p_user_id = v_uid then v_actor || ' left the chat'
                 else v_actor || ' removed ' || v_target end,
            'system');
  end if;
end $$;

grant execute on function public.remove_thread_participant(uuid, uuid) to authenticated;

-- Group chats: let a crew participant pull ANOTHER crew member into a thread.
--
-- The add/remove is already handled by add_thread_participant /
-- remove_thread_participant (20260716710000). This adds the picker's data source:
-- the tenant's crew members who AREN'T already in the thread, with resolved
-- names. SECURITY DEFINER + participant-gated so the crew UI doesn't need direct
-- reads on tenant_members / profiles.
--
-- Also fixes assign_thread_contact: the "Now handled by …" system line was
-- always tagged sender_type='vessel', so the crew inbox showed it as "You:"
-- even though the SUPPLIER did the assigning. Tag it by the actual actor's side.

create or replace function public.assign_thread_contact(
  p_thread_id  uuid,
  p_contact_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_supplier uuid;
  v_cuser    uuid;
  v_cname    text;
  v_party    text;
  v_stype    text;
begin
  if not public.is_thread_participant(p_thread_id, v_uid) then
    raise exception 'not a participant of this thread';
  end if;

  select supplier_id into v_supplier
  from public.supplier_message_threads where id = p_thread_id;
  if v_supplier is null then raise exception 'thread not found'; end if;

  if p_contact_id is not null then
    select user_id, coalesce(nullif(name, ''), initcap(role))
      into v_cuser, v_cname
    from public.supplier_contacts
    where id = p_contact_id and supplier_id = v_supplier;
    if not found then raise exception 'that contact is not with this supplier'; end if;
  end if;

  update public.supplier_message_threads
     set supplier_contact_id = p_contact_id
   where id = p_thread_id;

  if v_cuser is not null then
    insert into public.supplier_message_thread_participants (thread_id, party, user_id, added_by)
    values (p_thread_id, 'supplier', v_cuser, v_uid)
    on conflict do nothing;
  end if;

  -- Attribute the system line to the side that actually assigned it, so the
  -- other side's inbox doesn't mislabel it as "You:".
  select party into v_party
  from public.supplier_message_thread_participants
  where thread_id = p_thread_id and user_id = v_uid
  limit 1;
  v_stype := case when v_party = 'crew' then 'vessel' else 'supplier' end;

  insert into public.supplier_messages (thread_id, sender_type, sender_user_id, body, kind)
  values (p_thread_id, v_stype, v_uid,
          case when p_contact_id is not null
            then 'Now handled by ' || coalesce(v_cname, 'a contact')
            else 'Assignment cleared' end,
          'system');
end $$;

grant execute on function public.assign_thread_contact(uuid, uuid) to authenticated;

create or replace function public.fetch_addable_crew_for_thread(p_thread_id uuid)
returns table (user_id uuid, name text, tier text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
begin
  if not public.is_thread_participant(p_thread_id, auth.uid()) then
    raise exception 'not a participant of this thread';
  end if;
  select tenant_id into v_tenant
  from public.supplier_message_threads where id = p_thread_id;

  return query
    select tm.user_id,
           coalesce(nullif(pr.full_name, ''), 'Crew'),
           tm.permission_tier
    from public.tenant_members tm
    left join public.profiles pr on pr.id = tm.user_id
    where tm.tenant_id = v_tenant
      and tm.status <> 'invited'
      and not exists (
        select 1 from public.supplier_message_thread_participants p
        where p.thread_id = p_thread_id and p.user_id = tm.user_id
      )
    order by coalesce(nullif(pr.full_name, ''), 'Crew');
end $$;

grant execute on function public.fetch_addable_crew_for_thread(uuid) to authenticated;

-- People change-lines + contact-card polish.
--
--   * add_thread_participant / remove_thread_participant now drop a system line
--     into the conversation ("X added Y", "X removed Y", "Y left"), attributed
--     to the side that made the change.
--   * fetch_thread_person_card prefers a crew member's per-vessel NOTIFICATION
--     email (crew_notification_emails) over their personal sign-in email.

-- Resolve a participant's display name (crew profile, else supplier contact).
create or replace function public.thread_display_name(p_thread uuid, p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(full_name, '') from public.profiles where id = p_uid),
    (select coalesce(nullif(sc.name, ''), initcap(sc.role))
       from public.supplier_contacts sc
       join public.supplier_message_threads t on t.supplier_id = sc.supplier_id
       where t.id = p_thread and sc.user_id = p_uid
       limit 1),
    'Someone'
  );
$$;
grant execute on function public.thread_display_name(uuid, uuid) to authenticated;

create or replace function public.add_thread_participant(
  p_thread  uuid,
  p_user_id uuid,
  p_party   text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_tenant   uuid;
  v_supplier uuid;
  v_ok       boolean;
  v_party    text;
  v_stype    text;
begin
  if not public.is_thread_participant(p_thread, v_uid) then
    raise exception 'not a participant of this thread';
  end if;
  if p_party not in ('crew', 'supplier') then raise exception 'bad party'; end if;

  select tenant_id, supplier_id into v_tenant, v_supplier
  from public.supplier_message_threads where id = p_thread;

  if p_party = 'crew' then
    select exists (
      select 1 from public.tenant_members tm
      where tm.tenant_id = v_tenant and tm.user_id = p_user_id and tm.status <> 'invited'
    ) into v_ok;
  else
    select exists (
      select 1 from public.supplier_contacts sc
      where sc.supplier_id = v_supplier and sc.user_id = p_user_id
    ) into v_ok;
  end if;
  if not v_ok then raise exception 'that person can''t be added to this side'; end if;

  insert into public.supplier_message_thread_participants (thread_id, party, user_id, added_by)
  values (p_thread, p_party, p_user_id, v_uid)
  on conflict do nothing;

  if found then
    select party into v_party
    from public.supplier_message_thread_participants
    where thread_id = p_thread and user_id = v_uid limit 1;
    v_stype := case when v_party = 'crew' then 'vessel' else 'supplier' end;
    insert into public.supplier_messages (thread_id, sender_type, sender_user_id, body, kind)
    values (p_thread, v_stype, v_uid,
            public.thread_display_name(p_thread, v_uid) || ' added ' || public.thread_display_name(p_thread, p_user_id),
            'system');
  end if;
end $$;
grant execute on function public.add_thread_participant(uuid, uuid, text) to authenticated;

create or replace function public.remove_thread_participant(
  p_thread  uuid,
  p_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_party  text;
  v_stype  text;
  v_actor  text;
  v_target text;
begin
  if not public.is_thread_participant(p_thread, v_uid) then
    raise exception 'not a participant of this thread';
  end if;

  -- Capture identity BEFORE the delete (self-removal drops the caller's row).
  select party into v_party
  from public.supplier_message_thread_participants
  where thread_id = p_thread and user_id = v_uid limit 1;
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

-- Contact card: prefer the crew member's per-vessel notification email.
create or replace function public.fetch_thread_person_card(p_thread_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant   uuid;
  v_supplier uuid;
  v_out      jsonb;
begin
  if not public.is_thread_participant(p_thread_id, auth.uid()) then
    raise exception 'not a participant of this thread';
  end if;
  if not public.is_thread_participant(p_thread_id, p_user_id) then
    raise exception 'that person is not in this thread';
  end if;

  select tenant_id, supplier_id into v_tenant, v_supplier
  from public.supplier_message_threads where id = p_thread_id;

  select jsonb_build_object(
           'party', 'crew',
           'name', coalesce(nullif(pr.full_name, ''), 'Crew'),
           'email', coalesce(nullif(cne.email, ''), pr.email),
           'avatar_url', pr.avatar_url,
           'tier', tm.permission_tier,
           'department', d.name
         ) into v_out
  from public.tenant_members tm
  left join public.profiles pr on pr.id = tm.user_id
  left join public.departments d on d.id = tm.department_id
  left join public.crew_notification_emails cne on cne.user_id = tm.user_id and cne.tenant_id = v_tenant
  where tm.tenant_id = v_tenant and tm.user_id = p_user_id
  limit 1;
  if v_out is not null then return v_out; end if;

  select jsonb_build_object(
           'party', 'supplier',
           'name', coalesce(nullif(sc.name, ''), initcap(sc.role)),
           'role', sc.role,
           'email', sc.email,
           'phone', sc.phone
         ) into v_out
  from public.supplier_contacts sc
  where sc.supplier_id = v_supplier and sc.user_id = p_user_id
  order by (sc.role = 'owner') desc
  limit 1;

  return coalesce(v_out, jsonb_build_object('party', 'unknown', 'name', 'Someone'));
end $$;
grant execute on function public.fetch_thread_person_card(uuid, uuid) to authenticated;

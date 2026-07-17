-- Step 5 of private threads: identifiable people + supplier-anchored assignment.
--
-- The thread is anchored to the SUPPLIER (it survives a contact changing
-- department or leaving the company — the conversation still reaches the
-- supplier). On top of that anchor a crew member can ASSIGN the thread to a
-- specific person at the supplier (Steve, Lisa …); that name shows under the
-- supplier's header in the inbox and can be reassigned at any time.
--
--   * get_or_create_dm_thread — the "+" opens the crew member's GENERAL
--     (unassigned) thread with a supplier, and always seeds a reachable supplier
--     participant (the owner/primary) so an unassigned message still lands.
--   * assign_thread_contact — set/clear the thread's assigned contact, adding
--     that person as a participant so it reaches them.
--   * fetch_supplier_contacts_for_thread — the supplier's people, for the
--     assign picker (crew RLS can't read supplier_contacts directly).
--   * fetch_my_threads_people — per-thread assigned contact + participant roster
--     (names + roles), so the UI can label rows and name each message's sender.

-- ── get_or_create_dm_thread: general by default, always reaches the supplier ──
create or replace function public.get_or_create_dm_thread(
  p_supplier_id uuid,
  p_tenant_id   uuid,
  p_contact_id  uuid default null
) returns public.supplier_message_threads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_contact uuid := p_contact_id;   -- assigned contact (null = general / unassigned)
  v_reach   uuid;                   -- a supplier user to seed so the thread reaches them
  v_thread  public.supplier_message_threads;
begin
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = v_uid and tm.status <> 'invited'
  ) then
    raise exception 'not a member of this vessel';
  end if;

  -- Reuse the caller's existing thread with this supplier at the same assignment
  -- (general reuses general; a specific contact reuses that contact's thread).
  select * into v_thread
  from public.supplier_message_threads t
  where t.supplier_id = p_supplier_id
    and t.tenant_id = p_tenant_id
    and t.created_by = v_uid
    and (t.supplier_contact_id is not distinct from v_contact)
  order by t.created_at asc
  limit 1;

  if v_thread.id is not null then
    return v_thread;
  end if;

  insert into public.supplier_message_threads
    (supplier_id, tenant_id, order_id, created_by, supplier_contact_id)
  values (p_supplier_id, p_tenant_id, null, v_uid, v_contact)
  returning * into v_thread;

  insert into public.supplier_message_thread_participants (thread_id, party, user_id, added_by)
  values (v_thread.id, 'crew', v_uid, v_uid)
  on conflict do nothing;

  -- Seed a reachable supplier participant: the assigned contact if given,
  -- otherwise the supplier's owner/primary with a login.
  if v_contact is not null then
    select user_id into v_reach from public.supplier_contacts where id = v_contact;
  else
    select user_id into v_reach
    from public.supplier_contacts
    where supplier_id = p_supplier_id and user_id is not null
    order by (role = 'owner') desc, created_at asc
    limit 1;
  end if;

  if v_reach is not null then
    insert into public.supplier_message_thread_participants (thread_id, party, user_id, added_by)
    values (v_thread.id, 'supplier', v_reach, v_uid)
    on conflict do nothing;
  end if;

  return v_thread;
end $$;

grant execute on function public.get_or_create_dm_thread(uuid, uuid, uuid) to authenticated;

-- ── assign_thread_contact: point the thread at a person (or clear it) ────────
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

  -- Adding the assignee as a participant is how it reaches them.
  if v_cuser is not null then
    insert into public.supplier_message_thread_participants (thread_id, party, user_id, added_by)
    values (p_thread_id, 'supplier', v_cuser, v_uid)
    on conflict do nothing;
  end if;

  insert into public.supplier_messages (thread_id, sender_type, sender_user_id, body, kind)
  values (p_thread_id, 'vessel', v_uid,
          case when p_contact_id is not null
            then 'Assigned to ' || coalesce(v_cname, 'a contact')
            else 'Assignment cleared' end,
          'system');
end $$;

grant execute on function public.assign_thread_contact(uuid, uuid) to authenticated;

-- ── fetch_supplier_contacts_for_thread: the assign picker's options ──────────
create or replace function public.fetch_supplier_contacts_for_thread(p_thread_id uuid)
returns table (contact_id uuid, name text, role text, has_login boolean)
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
    select sc.id,
           coalesce(nullif(sc.name, ''), initcap(sc.role)),
           sc.role,
           sc.user_id is not null
    from public.supplier_contacts sc
    where sc.supplier_id = v_supplier
    order by (sc.role = 'owner') desc, coalesce(nullif(sc.name, ''), sc.role);
end $$;

grant execute on function public.fetch_supplier_contacts_for_thread(uuid) to authenticated;

-- ── fetch_my_threads_people: assigned contact + roster for my threads ────────
-- One row per thread the caller participates in: the assigned contact (or null)
-- and the participant roster with resolved display names + roles. Drives the
-- inbox row labels (assigned contact under the supplier header) and the
-- per-message sender names in group conversations.
create or replace function public.fetch_my_threads_people()
returns table (thread_id uuid, assigned jsonb, people jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    case when t.supplier_contact_id is not null then (
      select jsonb_build_object(
               'contact_id', sc.id,
               'name', coalesce(nullif(sc.name, ''), initcap(sc.role)),
               'role', sc.role)
      from public.supplier_contacts sc
      where sc.id = t.supplier_contact_id
    ) else null end as assigned,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', p.user_id,
               'party',   p.party,
               'name',    pn.name,
               'role',    pn.role)
             order by p.party, pn.name)
      from public.supplier_message_thread_participants p
      cross join lateral (
        select
          case when p.party = 'crew'
            then (select full_name from public.profiles where id = p.user_id)
            else (select coalesce(nullif(sc.name, ''), initcap(sc.role))
                  from public.supplier_contacts sc
                  where sc.user_id = p.user_id and sc.supplier_id = t.supplier_id limit 1)
          end as name,
          case when p.party = 'crew'
            then (select permission_tier from public.tenant_members
                  where user_id = p.user_id and tenant_id = t.tenant_id limit 1)
            else (select role from public.supplier_contacts
                  where user_id = p.user_id and supplier_id = t.supplier_id limit 1)
          end as role
      ) pn
      where p.thread_id = t.id
    ), '[]'::jsonb) as people
  from public.supplier_message_threads t
  where public.is_thread_participant(t.id, auth.uid());
$$;

grant execute on function public.fetch_my_threads_people() to authenticated;

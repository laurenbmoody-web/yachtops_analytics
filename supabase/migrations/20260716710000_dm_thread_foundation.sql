-- Private 1:1 messaging (step A, NON-BREAKING): the DB foundation for
-- contact-level threads. Adds the identity columns + the creation and
-- participant-management RPCs. RLS on threads/messages is UNCHANGED here — the
-- enforcement flip lands in the next step once the app creates threads this way.
--
-- Model: a thread is a persistent conversation between ONE crew member and ONE
-- supplier contact (group-expandable). created_by = the crew owner;
-- supplier_contact_id = the specific person at the supplier. order_id is no
-- longer a thread's identity (kept nullable for legacy rows only).

alter table public.supplier_message_threads
  add column if not exists created_by         uuid references auth.users(id) on delete set null,
  add column if not exists supplier_contact_id uuid references public.supplier_contacts(id) on delete set null;

-- Open (or reuse) the caller's 1:1 thread with a specific supplier contact.
-- Crew-only: the caller must be an active member of the tenant. Stamps the crew
-- owner + that supplier contact as participants.
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
  v_uid          uuid := auth.uid();
  v_contact      uuid;
  v_contact_user uuid;
  v_thread       public.supplier_message_threads;
begin
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = v_uid and tm.status <> 'invited'
  ) then
    raise exception 'not a member of this vessel';
  end if;

  -- Resolve the contact: the one asked for, else the supplier's owner/primary
  -- contact that has a login.
  if p_contact_id is not null then
    v_contact := p_contact_id;
  else
    select id into v_contact
    from public.supplier_contacts
    where supplier_id = p_supplier_id and user_id is not null
    order by (role = 'owner') desc, created_at asc
    limit 1;
  end if;

  select user_id into v_contact_user from public.supplier_contacts where id = v_contact;

  -- Reuse the caller's existing 1:1 with this contact (or, for a supplier with
  -- no contact resolved, their existing thread with this supplier).
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

  -- Participants: the crew owner + the supplier contact (if they have a login).
  insert into public.supplier_message_thread_participants (thread_id, party, user_id, added_by)
  values (v_thread.id, 'crew', v_uid, v_uid)
  on conflict do nothing;

  if v_contact_user is not null then
    insert into public.supplier_message_thread_participants (thread_id, party, user_id, added_by)
    values (v_thread.id, 'supplier', v_contact_user, v_uid)
    on conflict do nothing;
  end if;

  return v_thread;
end $$;

grant execute on function public.get_or_create_dm_thread(uuid, uuid, uuid) to authenticated;

-- Add someone to a thread (group). Only an existing participant may add people;
-- the added user must belong to the right side (crew = tenant member; supplier =
-- a contact of the thread's supplier).
create or replace function public.add_thread_participant(
  p_thread uuid,
  p_user_id uuid,
  p_party  text
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
end $$;

grant execute on function public.add_thread_participant(uuid, uuid, text) to authenticated;

-- Remove someone from a thread (or leave it yourself). Only an existing
-- participant may remove people.
create or replace function public.remove_thread_participant(
  p_thread uuid,
  p_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_thread_participant(p_thread, v_uid) then
    raise exception 'not a participant of this thread';
  end if;
  delete from public.supplier_message_thread_participants
  where thread_id = p_thread and user_id = p_user_id;
end $$;

grant execute on function public.remove_thread_participant(uuid, uuid) to authenticated;

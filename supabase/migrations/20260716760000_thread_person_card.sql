-- Contact cards for thread participants + department on the add-crew picker.
--
--   * fetch_thread_person_card — full detail for one participant (crew: tier +
--     department + email + avatar; supplier: role + email + phone), for the card
--     that opens when you click a face. Participant-gated both ways: the caller
--     must be in the thread, and so must the person asked about.
--   * fetch_addable_crew_for_thread — now also returns the crew member's
--     department, so the picker can group by it.

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

  -- Crew member?
  select jsonb_build_object(
           'party', 'crew',
           'name', coalesce(nullif(pr.full_name, ''), 'Crew'),
           'email', pr.email,
           'avatar_url', pr.avatar_url,
           'tier', tm.permission_tier,
           'department', d.name
         ) into v_out
  from public.tenant_members tm
  left join public.profiles pr on pr.id = tm.user_id
  left join public.departments d on d.id = tm.department_id
  where tm.tenant_id = v_tenant and tm.user_id = p_user_id
  limit 1;
  if v_out is not null then return v_out; end if;

  -- Otherwise a supplier contact.
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

-- Add department to the addable-crew picker so it can group by it.
create or replace function public.fetch_addable_crew_for_thread(p_thread_id uuid)
returns table (user_id uuid, name text, tier text, department text)
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
           tm.permission_tier,
           d.name
    from public.tenant_members tm
    left join public.profiles pr on pr.id = tm.user_id
    left join public.departments d on d.id = tm.department_id
    where tm.tenant_id = v_tenant
      and tm.status <> 'invited'
      and not exists (
        select 1 from public.supplier_message_thread_participants p
        where p.thread_id = p_thread_id and p.user_id = tm.user_id
      )
    order by d.name nulls last, coalesce(nullif(pr.full_name, ''), 'Crew');
end $$;

grant execute on function public.fetch_addable_crew_for_thread(uuid) to authenticated;

-- Richer crew contact card: position/rank, phone, and a better avatar source.
--
--   * position — the crew member's role/rank (roles.name via tenant_members.role_id).
--   * phone    — their personal contact number (personal_profile.phone), which is
--                already editable on /my-profile. No new field needed.
--   * avatar   — prefer personal_profile.avatar_url (where the profile page saves
--                it), falling back to profiles.avatar_url.
--   * user_id  — echoed back so the UI can link to /profile/<id>.
-- Supplier branch unchanged.

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
           'user_id', tm.user_id,
           'name', coalesce(nullif(pr.full_name, ''), 'Crew'),
           'email', coalesce(nullif(cne.email, ''), pr.email),
           'phone', ppf.phone,
           'avatar_url', coalesce(nullif(ppf.avatar_url, ''), pr.avatar_url),
           'position', rl.name,
           'tier', tm.permission_tier,
           'department', d.name
         ) into v_out
  from public.tenant_members tm
  left join public.profiles pr on pr.id = tm.user_id
  left join public.departments d on d.id = tm.department_id
  left join public.roles rl on rl.id = tm.role_id
  left join public.personal_profile ppf on ppf.user_id = tm.user_id
  left join public.crew_notification_emails cne on cne.user_id = tm.user_id and cne.tenant_id = v_tenant
  where tm.tenant_id = v_tenant and tm.user_id = p_user_id
  limit 1;
  if v_out is not null then return v_out; end if;

  select jsonb_build_object(
           'party', 'supplier',
           'user_id', sc.user_id,
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

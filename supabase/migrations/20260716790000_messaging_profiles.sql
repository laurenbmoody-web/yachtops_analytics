-- Messaging profiles — a light, WhatsApp-style identity every messaging user
-- (crew AND supplier) gets, SEPARATE from the HR crew profile.
--
-- Why: the contact card was pulling a crew member's PERSONAL phone
-- (personal_profile.phone) and linking to their full HR profile (seatime,
-- documents, next of kin). Neither is right to show colleagues/suppliers. This
-- gives each user a work-facing messaging identity they control:
--   * work_phone — a work number, distinct from the personal one.
--   * about      — a short status line ("Back Mon, covering AM orders").
-- Owner-editable; everyone else reads it only through the SECURITY DEFINER card
-- RPC (so no broad SELECT policy is needed).

create table if not exists public.messaging_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  about      text,
  work_phone text,
  updated_at timestamptz not null default now()
);

alter table public.messaging_profiles enable row level security;

drop policy if exists "mp_owner_all" on public.messaging_profiles;
create policy "mp_owner_all" on public.messaging_profiles
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Card RPC: work phone + about. Crew phone now comes from the messaging profile
-- (not the personal one); supplier keeps its business contact number.
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
           'phone', mp.work_phone,
           'about', mp.about,
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
  left join public.messaging_profiles mp on mp.user_id = tm.user_id
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
           'phone', coalesce(nullif(mp.work_phone, ''), sc.phone),
           'about', mp.about
         ) into v_out
  from public.supplier_contacts sc
  left join public.messaging_profiles mp on mp.user_id = sc.user_id
  where sc.supplier_id = v_supplier and sc.user_id = p_user_id
  order by (sc.role = 'owner') desc
  limit 1;

  return coalesce(v_out, jsonb_build_object('party', 'unknown', 'name', 'Someone'));
end $$;

grant execute on function public.fetch_thread_person_card(uuid, uuid) to authenticated;

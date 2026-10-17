-- Access & security for beta testers (anyone running a TestFlight build).
--
--   • terms_acceptances — the app asks every beta tester to accept the beta
--     terms (confidentiality, no copying, one person per account) before use,
--     and records who accepted which version, when and on what device.
--   • enforce_device_limit(p_beta) — called after every sign-in: a beta
--     tester keeps at most 2 devices signed in (a vessel can set its own cap
--     in tenants.max_devices_per_user, which applies to everyone on it); the
--     oldest extra device is signed out.
--   • security_events — sign-ins, screenshots and screen recordings reported
--     by the app; Command sees them, with each person's devices, on Vessel
--     settings → Access & security (get_tenant_access_activity).
--   • tenants.security_exempt — the App Store review demo vessel opts out of
--     the terms screen and the device cap.

alter table public.tenants add column if not exists security_exempt boolean not null default false;
alter table public.tenants add column if not exists max_devices_per_user integer
  check (max_devices_per_user is null or max_devices_per_user between 1 and 10);

-- ── Terms acceptances ─────────────────────────────────────────────────────────
create table if not exists public.terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  terms_key text not null,
  version text not null,
  accepted_at timestamptz not null default now(),
  platform text,
  user_agent text,
  unique (user_id, terms_key, version)
);
alter table public.terms_acceptances enable row level security;

drop policy if exists terms_acceptances_insert_own on public.terms_acceptances;
create policy terms_acceptances_insert_own on public.terms_acceptances
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists terms_acceptances_select on public.terms_acceptances;
create policy terms_acceptances_select on public.terms_acceptances
  for select to authenticated
  using (user_id = auth.uid() or (tenant_id is not null and public.is_command_in_tenant(tenant_id)));

-- ── Security events ───────────────────────────────────────────────────────────
create table if not exists public.security_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('login', 'screenshot', 'screen_recording', 'device_signed_out')),
  screen text,
  platform text,
  device text,
  created_at timestamptz not null default now()
);
create index if not exists security_events_tenant_created_idx on public.security_events (tenant_id, created_at desc);
alter table public.security_events enable row level security;

drop policy if exists security_events_insert_own on public.security_events;
create policy security_events_insert_own on public.security_events
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_active_tenant_member(tenant_id, auth.uid()));

drop policy if exists security_events_select_command on public.security_events;
create policy security_events_select_command on public.security_events
  for select to authenticated using (public.is_command_in_tenant(tenant_id));

-- ── Command: the vessel's own device cap ─────────────────────────────────────
create or replace function public.set_tenant_device_cap(p_tenant uuid, p_max_devices integer)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_command_in_tenant(p_tenant) then
    raise exception 'Only Command can change access settings' using errcode = '42501';
  end if;
  update public.tenants set max_devices_per_user = p_max_devices where id = p_tenant;
end $$;
revoke all on function public.set_tenant_device_cap(uuid, integer) from public, anon;
grant execute on function public.set_tenant_device_cap(uuid, integer) to authenticated;

-- ── After every sign-in: keep only the newest N devices ──────────────────────
-- N = the strictest cap among the caller's active, non-exempt vessels; a beta
-- tester (p_beta) on any non-exempt vessel is capped at 2 at most. The current
-- session always survives. Removing a session revokes its refresh tokens, so
-- that device is signed out when its access token next needs refreshing.
create or replace function public.enforce_device_limit(p_beta boolean default false)
returns integer
language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid uuid := auth.uid();
  v_current uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_cap integer;
  v_tenant uuid;
  v_removed integer := 0;
begin
  if v_uid is null then return 0; end if;

  select min(t.max_devices_per_user), (array_agg(t.id order by t.max_devices_per_user nulls last))[1]
    into v_cap, v_tenant
    from public.tenant_members m join public.tenants t on t.id = m.tenant_id
   where m.user_id = v_uid and m.active = true and not t.security_exempt;
  if v_tenant is null then return 0; end if;          -- only on exempt vessels
  if p_beta then v_cap := least(coalesce(v_cap, 2), 2); end if;
  if v_cap is null then return 0; end if;

  with ranked as (
    select s.id, row_number() over (order by coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) desc) as rn
      from auth.sessions s
     where s.user_id = v_uid and s.id is distinct from v_current
  ), gone as (
    delete from auth.sessions s using ranked r
     where s.id = r.id and r.rn > greatest(v_cap - 1, 0)
    returning 1
  )
  select count(*) into v_removed from gone;

  if v_removed > 0 then
    insert into public.security_events (tenant_id, user_id, kind, device)
    values (v_tenant, v_uid, 'device_signed_out', v_removed || ' older device' || case when v_removed = 1 then '' else 's' end);
  end if;
  return v_removed;
end $$;
revoke all on function public.enforce_device_limit(boolean) from public, anon;
grant execute on function public.enforce_device_limit(boolean) to authenticated;

-- ── Command: who is signed in where ──────────────────────────────────────────
create or replace function public.get_tenant_access_activity(p_tenant uuid)
returns table (
  user_id uuid,
  name text,
  email text,
  permission_tier text,
  devices integer,
  last_seen_at timestamptz,
  sessions jsonb,
  logins_30d integer,
  screenshots_30d integer,
  recordings_30d integer,
  terms_version text,
  terms_accepted_at timestamptz
)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_command_in_tenant(p_tenant) then
    raise exception 'Only Command can view access activity' using errcode = '42501';
  end if;
  return query
  select m.user_id,
         coalesce(p.full_name, m.display_name, u.email)::text,
         u.email::text,
         m.permission_tier::text,
         (select count(*)::int from auth.sessions s where s.user_id = m.user_id),
         (select max(coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at)) from auth.sessions s where s.user_id = m.user_id),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'created_at', s.created_at,
                     'last_active_at', coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at),
                     'user_agent', s.user_agent,
                     'ip', host(s.ip)) order by coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) desc)
                   from auth.sessions s where s.user_id = m.user_id), '[]'::jsonb),
         (select count(*)::int from public.security_events e where e.tenant_id = p_tenant and e.user_id = m.user_id and e.kind = 'login' and e.created_at > now() - interval '30 days'),
         (select count(*)::int from public.security_events e where e.tenant_id = p_tenant and e.user_id = m.user_id and e.kind = 'screenshot' and e.created_at > now() - interval '30 days'),
         (select count(*)::int from public.security_events e where e.tenant_id = p_tenant and e.user_id = m.user_id and e.kind = 'screen_recording' and e.created_at > now() - interval '30 days'),
         a.version,
         a.accepted_at
    from public.tenant_members m
    left join public.profiles p on p.id = m.user_id
    left join auth.users u on u.id = m.user_id
    left join lateral (
      select ta.version, ta.accepted_at from public.terms_acceptances ta
       where ta.user_id = m.user_id and ta.terms_key = 'beta'
       order by ta.accepted_at desc limit 1
    ) a on true
   where m.tenant_id = p_tenant and m.active = true and m.user_id is not null
   order by 2;
end $$;
revoke all on function public.get_tenant_access_activity(uuid) from public, anon;
grant execute on function public.get_tenant_access_activity(uuid) to authenticated;

-- The App Store review demo vessel (M/Y Aurora).
update public.tenants set security_exempt = true where id = 'dece0000-0000-4000-8000-000000000001';

-- ── Alerts to Cargo's platform admins ────────────────────────────────────────
-- Copying usually shows up as: a screen recording, a burst of screenshots, or
-- one account used on several devices. Each raises an in-app notification
-- (type SECURITY_ALERT) for every platform admin, at most once per person per
-- reason per hour. The exempt demo vessel never alerts.
create table if not exists public.security_alerts (
  id bigint generated always as identity primary key,
  tenant_id uuid references public.tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  reason text not null,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists security_alerts_user_reason_idx on public.security_alerts (user_id, reason, created_at desc);
alter table public.security_alerts enable row level security;
drop policy if exists security_alerts_select_admin on public.security_alerts;
create policy security_alerts_select_admin on public.security_alerts
  for select to authenticated
  using (exists (select 1 from public.platform_admins pa where lower(pa.email) = lower(auth.jwt() ->> 'email')));

create or replace function public.security_event_alert()
returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  v_reason text;
  v_detail text;
  v_who text;
  v_vessel text;
  v_n integer;
begin
  if exists (select 1 from public.tenants t where t.id = new.tenant_id and t.security_exempt) then
    return new;
  end if;

  if new.kind = 'screen_recording' then
    v_reason := 'screen_recording';
    v_detail := 'started a screen recording';
  elsif new.kind = 'screenshot' then
    select count(*) into v_n from public.security_events e
     where e.user_id = new.user_id and e.kind = 'screenshot' and e.created_at > now() - interval '10 minutes';
    if v_n >= 3 then
      v_reason := 'screenshots';
      v_detail := 'took ' || v_n || ' screenshots in 10 minutes';
    end if;
  elsif new.kind = 'device_signed_out' then
    v_reason := 'too_many_devices';
    v_detail := 'signed in on more devices than allowed (' || coalesce(new.device, 'older device') || ' signed out)';
  elsif new.kind = 'login' then
    select count(*) into v_n from auth.sessions s where s.user_id = new.user_id;
    if v_n >= 4 then
      v_reason := 'many_devices';
      v_detail := 'is signed in on ' || v_n || ' devices at once — possible shared account';
    end if;
  end if;

  if v_reason is null then return new; end if;
  if exists (select 1 from public.security_alerts a
              where a.user_id = new.user_id and a.reason = v_reason and a.created_at > now() - interval '1 hour') then
    return new;
  end if;

  select coalesce(p.full_name, u.email) into v_who
    from auth.users u left join public.profiles p on p.id = u.id where u.id = new.user_id;
  select name into v_vessel from public.tenants where id = new.tenant_id;

  insert into public.security_alerts (tenant_id, user_id, reason, detail)
  values (new.tenant_id, new.user_id, v_reason, v_detail);

  insert into public.notifications (user_id, type, title, message, severity)
  select u.id, 'SECURITY_ALERT', 'Security: ' || coalesce(v_who, 'someone'),
         coalesce(v_who, 'Someone') || ' on ' || coalesce(v_vessel, 'a vessel') || ' ' || v_detail
           || coalesce(' (screen: ' || new.screen || ')', '') || '.',
         'warning'
    from public.platform_admins pa join auth.users u on lower(u.email) = lower(pa.email);
  return new;
exception when others then
  return new; -- never block the event itself
end $$;

drop trigger if exists security_events_alert_trg on public.security_events;
create trigger security_events_alert_trg after insert on public.security_events
  for each row execute function public.security_event_alert();

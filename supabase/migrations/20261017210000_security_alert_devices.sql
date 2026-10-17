-- Where security alerts are pushed.
--
-- Pushes go to every device of (a) the Cargo console admins
-- (platform_admins) and (b) the accounts on security_alert_recipients —
-- alert-only accounts, e.g. an admin's own crew account on the phone they
-- carry. Recipients get the push but no console access. Removing one sets
-- removed_at (kept for the record).
--
-- push_subscriptions.tenant_id becomes optional: a browser enrolled only for
-- security alerts (the console's "Get alerts on this device") belongs to no
-- vessel. Vessel pushes filter by tenant / topic, so they're unaffected.

alter table public.push_subscriptions alter column tenant_id drop not null;

create table if not exists public.security_alert_recipients (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  removed_at timestamptz
);
alter table public.security_alert_recipients enable row level security;
-- No policies: read and written only through the functions below.

create or replace function public.list_security_alert_recipients()
returns table (user_id uuid, email text, name text, devices integer, added_at timestamptz, kind text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Cargo console only' using errcode = '42501';
  end if;
  return query
  select u.id, u.email::text, coalesce(p.full_name, u.email)::text,
         (select count(*)::int from public.push_subscriptions s where s.user_id = u.id),
         null::timestamptz, 'admin'::text
    from public.platform_admins pa join auth.users u on lower(u.email) = lower(pa.email)
    left join public.profiles p on p.id = u.id
  union all
  select u.id, u.email::text, coalesce(p.full_name, u.email)::text,
         (select count(*)::int from public.push_subscriptions s where s.user_id = u.id),
         r.added_at, 'alerts only'::text
    from public.security_alert_recipients r join auth.users u on u.id = r.user_id
    left join public.profiles p on p.id = u.id
   where r.removed_at is null;
end $$;
revoke all on function public.list_security_alert_recipients() from public, anon;
grant execute on function public.list_security_alert_recipients() to authenticated;

create or replace function public.add_security_alert_recipient(p_email text)
returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Cargo console only' using errcode = '42501';
  end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then
    raise exception 'No Cargo account with that email' using errcode = 'P0002';
  end if;
  insert into public.security_alert_recipients (user_id, added_by) values (v_uid, auth.uid())
  on conflict (user_id) do update set removed_at = null, added_by = excluded.added_by, added_at = now();
  return v_uid;
end $$;
revoke all on function public.add_security_alert_recipient(text) from public, anon;
grant execute on function public.add_security_alert_recipient(text) to authenticated;

create or replace function public.remove_security_alert_recipient(p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Cargo console only' using errcode = '42501';
  end if;
  update public.security_alert_recipients set removed_at = now() where user_id = p_user;
end $$;
revoke all on function public.remove_security_alert_recipient(uuid) from public, anon;
grant execute on function public.remove_security_alert_recipient(uuid) to authenticated;

-- A test alert from the console, to check devices receive pushes.
create or replace function public.send_test_security_alert()
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
  v_anon constant text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3ZXhicmJhc2Z5c2JoZWVrbHlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNTc5NDksImV4cCI6MjA4NDgzMzk0OX0.dfUXJ2ZepeZ4bNSKGjhoxwI-FgXMSU-lF465eGlWQ5M';
begin
  if not public.is_platform_admin() then
    raise exception 'Cargo console only' using errcode = '42501';
  end if;
  insert into public.security_alerts (reason, detail, seen_at)
  values ('test', 'Test alert — security push notifications are reaching this device.', now())
  returning id into v_id;
  perform net.http_post(
    url := 'https://gwexbrbasfysbheeklyq.supabase.co/functions/v1/security-alert-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_anon, 'Authorization', 'Bearer ' || v_anon),
    body := jsonb_build_object('alert_id', v_id)
  );
  return v_id;
end $$;
revoke all on function public.send_test_security_alert() from public, anon;
grant execute on function public.send_test_security_alert() to authenticated;

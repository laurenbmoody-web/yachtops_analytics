-- Security alerts belong to Cargo (the company), not to any vessel: they no
-- longer go into the crew notifications bell. They live in security_alerts,
-- are listed on the Cargo console (/cargo/security, platform admins only,
-- list_security_alerts) and are pushed to the admins' devices by the
-- security-alert-push edge function, called here via pg_net.

alter table public.security_alerts add column if not exists pushed_at timestamptz;
alter table public.security_alerts add column if not exists seen_at timestamptz;

create or replace function public.list_security_alerts(p_limit integer default 200)
returns table (id bigint, created_at timestamptz, reason text, detail text, seen_at timestamptz,
               user_id uuid, person text, email text, tenant_id uuid, vessel text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Cargo console only' using errcode = '42501';
  end if;
  return query
  select a.id, a.created_at, a.reason, a.detail, a.seen_at, a.user_id,
         coalesce(p.full_name, u.email)::text, u.email::text, a.tenant_id, t.name::text
    from public.security_alerts a
    left join auth.users u on u.id = a.user_id
    left join public.profiles p on p.id = a.user_id
    left join public.tenants t on t.id = a.tenant_id
   order by a.created_at desc
   limit greatest(1, least(coalesce(p_limit, 200), 1000));
end $$;
revoke all on function public.list_security_alerts(integer) from public, anon;
grant execute on function public.list_security_alerts(integer) to authenticated;

create or replace function public.mark_security_alerts_seen()
returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.is_platform_admin() then return 0; end if;
  update public.security_alerts set seen_at = now() where seen_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.mark_security_alerts_seen() from public, anon;
grant execute on function public.mark_security_alerts_seen() to authenticated;

create or replace function public.security_event_alert()
returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  v_reason text;
  v_detail text;
  v_who text;
  v_vessel text;
  v_n integer;
  v_id bigint;
  -- The project's public anon key (as used by the cron push jobs).
  v_anon constant text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3ZXhicmJhc2Z5c2JoZWVrbHlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNTc5NDksImV4cCI6MjA4NDgzMzk0OX0.dfUXJ2ZepeZ4bNSKGjhoxwI-FgXMSU-lF465eGlWQ5M';
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
  values (new.tenant_id, new.user_id, v_reason,
          coalesce(v_who, 'Someone') || ' on ' || coalesce(v_vessel, 'a vessel') || ' ' || v_detail
            || coalesce(' (screen: ' || new.screen || ')', '') || '.')
  returning id into v_id;

  perform net.http_post(
    url := 'https://gwexbrbasfysbheeklyq.supabase.co/functions/v1/security-alert-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_anon, 'Authorization', 'Bearer ' || v_anon),
    body := jsonb_build_object('alert_id', v_id)
  );
  return new;
exception when others then
  return new; -- never block the event itself
end $$;

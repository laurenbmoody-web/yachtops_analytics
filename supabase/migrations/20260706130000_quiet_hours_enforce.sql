-- Make Quiet hours actually work: hold the in-app bell during a crew member's
-- quiet window. Until now quiet_enabled/quiet_from/quiet_to were stored but
-- nothing read them, and there was no timezone to know the crew's local night.
--
-- 1) Store the crew member's timezone alongside the window (captured from the
--    browser when they set it), so we compare against THEIR local wall-clock.
-- 2) A BEFORE INSERT trigger on public.notifications: if the recipient is inside
--    their quiet window, pre-mark the row read so it doesn't ping or add to the
--    unread bell badge. The notification is still stored (visible in the list) —
--    it just doesn't disturb overnight. Emails are unaffected (bell only).

alter table public.notification_preferences
  add column if not exists quiet_tz text not null default 'UTC';

create or replace function public.hold_quiet_hours_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p       record;
  local_t time;
begin
  select quiet_enabled, quiet_from, quiet_to, coalesce(nullif(quiet_tz, ''), 'UTC') as tz
    into p
  from public.notification_preferences
  where user_id = NEW.user_id;

  -- No prefs row, quiet off, or an incomplete window → deliver normally.
  if not found or not p.quiet_enabled or p.quiet_from is null or p.quiet_to is null
     or p.quiet_from = p.quiet_to then
    return NEW;
  end if;

  -- Current wall-clock in the crew member's timezone (fall back to UTC if the
  -- stored tz name is invalid, so a bad tz can never block the notification).
  begin
    local_t := (now() at time zone p.tz)::time;
  exception when others then
    local_t := (now() at time zone 'UTC')::time;
  end;

  if (p.quiet_from < p.quiet_to and local_t >= p.quiet_from and local_t < p.quiet_to)
     or (p.quiet_from > p.quiet_to and (local_t >= p.quiet_from or local_t < p.quiet_to))
  then
    NEW.read := true;   -- hold the bell: stored, but silent (no ping / badge)
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_hold_quiet_hours on public.notifications;
create trigger trg_hold_quiet_hours
  before insert on public.notifications
  for each row execute function public.hold_quiet_hours_notification();

-- Wire up the per-category In-app notification toggles.
--
-- Until now the notify_* preference columns were saved from the profile but
-- nothing read them: sendDbNotification (and the cron/RPCs) inserted a bell row
-- regardless, so switching a category "In-app" off did nothing. This folds a
-- per-type opt-out into the existing BEFORE INSERT trigger on
-- public.notifications: if the recipient has turned OFF the in-app channel for
-- the category a notification belongs to, the bell row is suppressed entirely
-- (no insert). Quiet-hours handling (mark-as-read during the window) is kept.
--
-- Mapping is by notification `type` (case-insensitive). Types with no mapping
-- always deliver — a preference only ever blocks a category it explicitly
-- covers, so a new/unknown type can never be silently dropped.

create or replace function public.hold_quiet_hours_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p       record;
  local_t time;
  want    boolean;   -- in-app channel on for this type? null = no mapping → deliver
begin
  select quiet_enabled, quiet_from, quiet_to,
         coalesce(nullif(quiet_tz, ''), 'UTC') as tz,
         notify_rota_submissions, notify_rota_decisions, notify_hor_reminders,
         notify_provisioning_approvals, notify_document_expiry, notify_returns,
         notify_seatime, notify_vessel_docs
    into p
  from public.notification_preferences
  where user_id = NEW.user_id;

  -- No prefs row → deliver everything (the table's own defaults are all-on).
  if not found then
    return NEW;
  end if;

  -- 1) Per-category In-app opt-out. If the recipient switched this category's
  --    in-app channel off, don't create the bell at all.
  -- Decisions on a rota you submitted.
  -- Approval requests awaiting your acceptance (rota + HoR submissions).
  -- Reminders to log / sign off your own Hours of Rest.
  -- Sea-service sign-off requests and decisions.
  -- Note: hor_sent_to_management is a self-confirmation of an action the user
  -- just took, not a governed category — left unmapped so it always delivers.
  want := case lower(NEW.type)
            when 'rota_accepted'        then p.notify_rota_decisions
            when 'rota_rejected'        then p.notify_rota_decisions
            when 'rota_submitted'       then p.notify_rota_submissions
            when 'hor_approval_pending' then p.notify_rota_submissions
            when 'hor_reminder'         then p.notify_hor_reminders
            when 'sea_time'             then p.notify_seatime
            when 'sea_time_submitted'   then p.notify_seatime
            else null
          end;
  if want is false then
    return null;   -- suppressed: opted out of this In-app category
  end if;

  -- 2) Quiet hours: deliver but silent (stored, pre-read) during the window.
  if not p.quiet_enabled or p.quiet_from is null or p.quiet_to is null
     or p.quiet_from = p.quiet_to then
    return NEW;
  end if;

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

-- Trigger already exists from 20260706130000; re-assert for idempotency.
drop trigger if exists trg_hold_quiet_hours on public.notifications;
create trigger trg_hold_quiet_hours
  before insert on public.notifications
  for each row execute function public.hold_quiet_hours_notification();

-- Remind me — but the way a boat needs it, not the way a phone does it.
--
-- Microsoft To Do's reminder is a timer on your handset: it fires on your
-- device, on your device's clock, whether or not the job still needs doing,
-- and only ever for the person who set it. Four of those are wrong here.
--
--  1. It runs on the server. pg_cron sweeps this table every five minutes and
--     writes a real public.notifications row, so a flat battery, a closed app
--     or a new phone does not lose the reminder — it is waiting in the bell.
--  2. It keeps VESSEL time. remind_local is a wall clock, not an instant, and
--     is resolved against vessels.timezone at fire time. "Remind me at 07:00"
--     means 07:00 on the boat, including after she has crossed a timezone on
--     passage — which is exactly when a phone-clock reminder goes wrong.
--  3. It checks the job first. If the job was finished (by anyone) before the
--     reminder came round, the reminder is cancelled rather than fired. To Do
--     cannot do this: its tasks are one person's, so it has nothing to check.
--  4. It respects a rest period. Crew asleep inside their notification_
--     preferences quiet window are not buzzed; the reminder is held and goes
--     out when the window ends. Waking someone on their rest hours is an
--     Hours of Rest problem, not just an annoyance. bypass_quiet overrides it
--     for something that genuinely cannot wait.
--
-- And two things To Do has no answer for at all:
--  • user_id is the person REMINDED, created_by the person who set it. A chief
--    can put the nudge on the assignee instead of having to remember to chase.
--  • Snoozing moves remind_local and counts, so "not now" comes back rather
--    than quietly disappearing.

create table if not exists public.job_reminders (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  job_id      uuid not null references public.team_jobs(id) on delete cascade,

  -- who gets buzzed, and who asked for it. Usually the same person.
  user_id     uuid not null,
  created_by  uuid,

  -- A WALL CLOCK, deliberately not a timestamptz: the vessel's own local time,
  -- resolved against her timezone when the sweep runs.
  remind_local timestamp not null,
  -- What it was set to before any snoozing, so the row can say "twice already".
  original_local timestamp,

  note        text,

  state       text not null default 'pending'
              check (state in ('pending', 'sent', 'cancelled')),
  sent_at     timestamptz,
  -- Why it stopped mattering: 'done' (job finished first) or 'user'.
  cancelled_reason text,

  snooze_count integer not null default 0,
  -- Set by the push function once the buzz has gone out, so a retry does not
  -- ring the same phone twice. The bell row is written by the DB sweep and is
  -- the record; the push is only the nudge towards it.
  pushed_at   timestamptz,
  -- For the one thing that must wake someone up regardless.
  bypass_quiet boolean not null default false,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- The sweep's only query shape: pending, ordered by when they come due.
create index if not exists job_reminders_due_idx
  on public.job_reminders (state, remind_local)
  where state = 'pending';

create index if not exists job_reminders_job_idx
  on public.job_reminders (job_id, state);

alter table public.job_reminders enable row level security;

-- Visible to the tenant, like the job itself — a chief setting a nudge on a
-- stew has to be able to see it is set, and the stew has to see who set it.
-- Case-insensitive on status: the column holds lowercase 'active'.
create policy job_reminders_select on public.job_reminders
  for select using (
    tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true and upper(tm.status) = 'ACTIVE'
    )
  );

create policy job_reminders_insert on public.job_reminders
  for insert with check (
    tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true and upper(tm.status) = 'ACTIVE'
    )
  );

-- Snoozing and cancelling are limited to the person reminded and the person
-- who set it. Anyone else clearing your reminder is how a job gets missed.
create policy job_reminders_update on public.job_reminders
  for update using (
    (user_id = auth.uid() or created_by = auth.uid())
    and tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true and upper(tm.status) = 'ACTIVE'
    )
  );

create policy job_reminders_delete on public.job_reminders
  for delete using (
    (user_id = auth.uid() or created_by = auth.uid())
    and tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true and upper(tm.status) = 'ACTIVE'
    )
  );


-- The vessel's own timezone, for turning a wall clock into an instant.
-- A tenant with more than one vessel takes the first named one; a tenant with
-- none falls back to UTC rather than dropping the reminder on the floor.
create or replace function public.tenant_timezone(p_tenant uuid)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select v.timezone from public.vessels v
      where v.tenant_id = p_tenant and v.timezone is not null
      order by v.name nulls last
      limit 1),
    'UTC'
  );
$$;


-- The sweep. Run it with p_commit => false to see what it WOULD do.
create or replace function public.jobs_run_due_reminders(
  p_now timestamptz default now(),
  p_commit boolean default true
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
DECLARE
  n_sent integer := 0;
BEGIN
  CREATE TEMP TABLE _jrplan ON COMMIT DROP AS
  SELECT
    r.id            AS reminder_id,
    r.tenant_id,
    r.job_id,
    r.user_id,
    r.note,
    r.snooze_count,
    j.title         AS job_title,
    j.status        AS job_status,
    -- Finished before the reminder came round: cancel, do not buzz.
    (lower(coalesce(j.status, '')) IN ('completed', 'done', 'cancelled', 'declined')) AS job_finished,
    -- Asleep on their rest hours, and this one can wait: hold it.
    (
      NOT r.bypass_quiet
      AND coalesce(np.quiet_enabled, false)
      AND np.quiet_from IS NOT NULL
      AND np.quiet_to IS NOT NULL
      AND np.quiet_from <> np.quiet_to
      AND (
        CASE
          -- Overnight window (22:00–07:00): inside if at/after start OR before end.
          WHEN np.quiet_from > np.quiet_to
            THEN (p_now AT TIME ZONE coalesce(np.quiet_tz, 'UTC'))::time >= np.quiet_from
              OR (p_now AT TIME ZONE coalesce(np.quiet_tz, 'UTC'))::time <  np.quiet_to
          -- Same-day window (13:00–14:00).
          ELSE (p_now AT TIME ZONE coalesce(np.quiet_tz, 'UTC'))::time >= np.quiet_from
           AND (p_now AT TIME ZONE coalesce(np.quiet_tz, 'UTC'))::time <  np.quiet_to
        END
      )
    ) AS in_quiet
  FROM public.job_reminders r
  JOIN public.team_jobs j ON j.id = r.job_id
  LEFT JOIN public.notification_preferences np ON np.user_id = r.user_id
  WHERE r.state = 'pending'
    -- The vessel-time resolution: a wall clock becomes an instant here.
    AND (r.remind_local AT TIME ZONE public.tenant_timezone(r.tenant_id)) <= p_now;

  IF NOT p_commit THEN
    SELECT count(*) INTO n_sent FROM _jrplan WHERE NOT job_finished AND NOT in_quiet;
    RETURN n_sent;
  END IF;

  -- Already done. Retire the reminder quietly.
  UPDATE public.job_reminders r
     SET state = 'cancelled', cancelled_reason = 'done', updated_at = now()
    FROM _jrplan p
   WHERE r.id = p.reminder_id AND p.job_finished;

  -- Still to do, and they are awake.
  INSERT INTO public.notifications (user_id, type, title, message, severity, action_url, read, created_at)
  SELECT p.user_id,
         'job_reminder',
         'Reminder',
         p.job_title || coalesce(' — ' || nullif(p.note, ''), ''),
         'info',
         '/team-jobs-management?job=' || p.job_id,
         false,
         now()
    FROM _jrplan p
   WHERE NOT p.job_finished AND NOT p.in_quiet;
  GET DIAGNOSTICS n_sent = ROW_COUNT;

  UPDATE public.job_reminders r
     SET state = 'sent', sent_at = now(), updated_at = now()
    FROM _jrplan p
   WHERE r.id = p.reminder_id AND NOT p.job_finished AND NOT p.in_quiet;

  -- Rows left 'pending' are the held ones. They come round again on the next
  -- sweep and go out the moment the quiet window ends.
  RETURN n_sent;
END;
$$;

revoke all on function public.jobs_run_due_reminders(timestamptz, boolean) from public, anon, authenticated;

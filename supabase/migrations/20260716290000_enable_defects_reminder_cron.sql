-- ─────────────────────────────────────────────────────────────────────────────
-- 20260716290000_enable_defects_reminder_cron.sql
--
-- Activate the daily defect reminder run (IN-APP notifications). Runs the engine
-- with p_commit = true once a day at 07:30 UTC — after the HOR (07:00/07:10) and
-- cert-expiry (07:20) jobs. Mirrors the HOR pure-SQL cron; add a net.http_post
-- edge-function schedule alongside this only if email reminders are wanted later.
--
-- IDEMPOTENT: unschedule-if-exists, then schedule.
-- ─────────────────────────────────────────────────────────────────────────────
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'defects-daily-reminders') then
    perform cron.unschedule('defects-daily-reminders');
  end if;
end $$;

select cron.schedule(
  'defects-daily-reminders',
  '30 7 * * *',
  $$ select public.defects_run_daily_reminders(current_date, true); $$
);

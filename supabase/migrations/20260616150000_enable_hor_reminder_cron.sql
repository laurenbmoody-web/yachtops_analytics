-- ─────────────────────────────────────────────────────────────────────────────
-- 20260616150000_enable_hor_reminder_cron.sql
--
-- Activate the daily HOR reminder run (IN-APP notifications). Runs the engine
-- with p_commit = true once a day at 07:00 UTC. The email escalation layer is
-- added separately (a Resend edge function); when that lands, this schedule is
-- replaced to drive the edge function instead.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'hor-daily-reminders') then
    perform cron.unschedule('hor-daily-reminders');
  end if;
end $$;

select cron.schedule(
  'hor-daily-reminders',
  '0 7 * * *',
  $$ select public.hor_run_daily_reminders(current_date, true); $$
);

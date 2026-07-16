-- ─────────────────────────────────────────────────────────────────────────────
-- 20260716320000_enable_defect_email_cron.sql
--
-- Daily High/Critical defect email run. Fires at 07:35 UTC (after the in-app
-- defects-daily-reminders pass at 07:30) and POSTs to the defect-reminders edge
-- function, which emails the day's High/Critical repair-due + quote-signoff
-- nudges. Mirrors the HOR/cert crons: the function authenticates internally with
-- the service role; the cron passes the public anon key just to reach the endpoint.
--
-- IDEMPOTENT: unschedule-if-exists, then schedule.
-- ─────────────────────────────────────────────────────────────────────────────
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'defect-daily-emails') then
    perform cron.unschedule('defect-daily-emails');
  end if;
end $$;

select cron.schedule(
  'defect-daily-emails',
  '35 7 * * *',
  $cron$
  select net.http_post(
    url := 'https://gwexbrbasfysbheeklyq.supabase.co/functions/v1/defect-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3ZXhicmJhc2Z5c2JoZWVrbHlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNTc5NDksImV4cCI6MjA4NDgzMzk0OX0.dfUXJ2ZepeZ4bNSKGjhoxwI-FgXMSU-lF465eGlWQ5M'
    ),
    body := '{}'::jsonb
  );
  $cron$
);

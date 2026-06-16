-- ─────────────────────────────────────────────────────────────────────────────
-- 20260616170000_enable_hor_reminder_email_cron.sql
--
-- Activate the daily HOR overdue EMAIL run. Fires at 07:10 UTC, just after the
-- 07:00 in-app pass, so in-app notifications are already deduped and the edge
-- function only has the overdue 'email' rows left to send. pg_net POSTs to the
-- hor-reminders edge function with the public anon key (the function itself
-- authenticates internally with the service role).
-- ─────────────────────────────────────────────────────────────────────────────

do $$
begin
  if exists (select 1 from cron.job where jobname = 'hor-daily-emails') then
    perform cron.unschedule('hor-daily-emails');
  end if;
end $$;

select cron.schedule(
  'hor-daily-emails',
  '10 7 * * *',
  $cron$
  select net.http_post(
    url := 'https://gwexbrbasfysbheeklyq.supabase.co/functions/v1/hor-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3ZXhicmJhc2Z5c2JoZWVrbHlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNTc5NDksImV4cCI6MjA4NDgzMzk0OX0.dfUXJ2ZepeZ4bNSKGjhoxwI-FgXMSU-lF465eGlWQ5M'
    ),
    body := '{}'::jsonb
  );
  $cron$
);

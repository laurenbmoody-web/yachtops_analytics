-- Daily renewal-reminder run. Fires at 07:20 UTC (after the HOR reminder jobs)
-- and POSTs to the cert-expiry-reminders edge function, which emails suppliers
-- (copied to Cargo) about certs approaching expiry. Mirrors the HOR cron: the
-- function authenticates internally with the service role; the cron passes the
-- public anon key just to reach the endpoint.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'cert-expiry-reminders-daily') then
    perform cron.unschedule('cert-expiry-reminders-daily');
  end if;
end $$;

select cron.schedule(
  'cert-expiry-reminders-daily',
  '20 7 * * *',
  $cron$
  select net.http_post(
    url := 'https://gwexbrbasfysbheeklyq.supabase.co/functions/v1/cert-expiry-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3ZXhicmJhc2Z5c2JoZWVrbHlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNTc5NDksImV4cCI6MjA4NDgzMzk0OX0.dfUXJ2ZepeZ4bNSKGjhoxwI-FgXMSU-lF465eGlWQ5M'
    ),
    body := '{}'::jsonb
  );
  $cron$
);

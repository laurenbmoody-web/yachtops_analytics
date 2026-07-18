-- Switch the laundry attention push from a fixed 14:00 UTC job to an hourly
-- job. The edge function now gates per-vessel: it only pushes when it's 4pm in
-- that vessel's own timezone (vessels.timezone), so each vessel gets its alert
-- at 4pm local (DST included) rather than one fixed UTC hour for everyone.
select cron.unschedule('laundry-attention-daily');

select cron.schedule(
  'laundry-attention-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://gwexbrbasfysbheeklyq.supabase.co/functions/v1/laundry-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3ZXhicmJhc2Z5c2JoZWVrbHlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNTc5NDksImV4cCI6MjA4NDgzMzk0OX0.dfUXJ2ZepeZ4bNSKGjhoxwI-FgXMSU-lF465eGlWQ5M'
    ),
    body := '{}'::jsonb
  );
  $$
);

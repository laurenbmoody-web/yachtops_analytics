-- Daily "laundry needs attention" push.
--
-- Calls the laundry-push edge function with an empty body, which scans each
-- vessel's open laundry for items that are urgent, overdue, or flagged
-- (missing/damaged) and pushes a one-line summary to that vessel's enrolled
-- devices (topic='laundry' — Interior/Command who opted in). No-op for a
-- vessel with nothing needing attention or no enrolled devices.
--
-- 14:00 UTC = 16:00 Central European Summer Time — the last hour of the
-- interior working day in the Med. Adjust if the vessel runs another timezone.
-- Auth mirrors the other reminder crons: the anon (publishable) apikey.

select cron.schedule(
  'laundry-attention-daily',
  '0 14 * * *',
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

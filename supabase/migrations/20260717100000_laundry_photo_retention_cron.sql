-- Schedule the opt-in laundry photo-retention housekeeping.
--
-- Runs daily and calls the laundry-photo-retention edge function, which purges
-- photo files for laundry items older than each vessel's retention window
-- (vessels.laundry_photo_retention_days). Vessels with NULL retention are
-- skipped, so this is a no-op until a vessel sets a policy in Settings. The
-- function only ever touches photos, never records, and is idempotent via
-- laundry_items.photos_expired_at.
--
-- Auth mirrors the other reminder crons: the anon (publishable) apikey; the
-- function itself runs with the service role from its own environment.
-- 04:15 UTC is chosen to sit clear of the existing daily reminder jobs.

select cron.schedule(
  'laundry-photo-retention-daily',
  '15 4 * * *',
  $$
  select net.http_post(
    url := 'https://gwexbrbasfysbheeklyq.supabase.co/functions/v1/laundry-photo-retention',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3ZXhicmJhc2Z5c2JoZWVrbHlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNTc5NDksImV4cCI6MjA4NDgzMzk0OX0.dfUXJ2ZepeZ4bNSKGjhoxwI-FgXMSU-lF465eGlWQ5M'
    ),
    body := '{}'::jsonb
  );
  $$
);

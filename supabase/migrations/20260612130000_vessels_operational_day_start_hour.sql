-- ─────────────────────────────────────────────────────────────────────────────
-- 20260612130000_vessels_operational_day_start_hour.sql
--
-- WHAT: Per-vessel configurable rota "operational day start hour" — the hour
--       the daily rota grid begins at (and the 24h slot window is anchored to).
--       Previously hardcoded to 06:00 (GRID_START_HOUR = 6) in the frontend.
--
--       This is a DISPLAY / slot-math boundary only. The MLC rest calculations
--       (restHours.js) group by calendar day (00:00) via shift_date and are
--       independent of this value, so changing it does not alter rest/MLC math.
--
-- COLUMN: vessels.operational_day_start_hour — integer 0–23, default 6 (the
--       prior constant, so existing vessels keep today's behaviour).
--
-- IDEMPOTENCY: ADD COLUMN IF NOT EXISTS + a guarded CHECK constraint. Safe to
--       re-apply. No RLS changes — the existing vessels policies (tenant-scoped
--       read, COMMAND-only write) already cover the new column.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS operational_day_start_hour integer NOT NULL DEFAULT 6;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vessels_operational_day_start_hour_check'
      AND conrelid = 'public.vessels'::regclass
  ) THEN
    ALTER TABLE public.vessels
      ADD CONSTRAINT vessels_operational_day_start_hour_check
        CHECK (operational_day_start_hour >= 0 AND operational_day_start_hour <= 23);
  END IF;
END $$;

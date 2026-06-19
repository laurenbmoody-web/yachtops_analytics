ALTER TABLE public.crew_employment
  ADD COLUMN IF NOT EXISTS probation_period_days integer;

COMMENT ON COLUMN public.crew_employment.probation_period_days IS
  'Probation length in days (7/30/60/90 or custom). When set, probation_end_date is derived from start_date + this. NULL when a custom end date was picked directly.';

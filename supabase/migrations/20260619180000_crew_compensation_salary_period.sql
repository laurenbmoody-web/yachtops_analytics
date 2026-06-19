ALTER TABLE public.crew_compensation
  ADD COLUMN IF NOT EXISTS salary_period text;

COMMENT ON COLUMN public.crew_compensation.salary_period IS
  'Salary frequency: month | year (NULL treated as month). Day rate is derived from the annualised salary / 365.';

-- Cargo Accounts — Phase 1.4. Per-month budget targets on budget_lines, for
-- seasonal budgeting (guest food heavy in season / nil off-season; uniforms a bulk
-- buy one month then small top-ups). `monthly` is a jsonb map of 'YYYY-MM' -> target
-- amount; the existing `amount` column is kept in sync as the annual/period total
-- (= sum of the monthly values when any are set). Empty {} means "annual only".

ALTER TABLE public.budget_lines
  ADD COLUMN IF NOT EXISTS monthly jsonb NOT NULL DEFAULT '{}'::jsonb;

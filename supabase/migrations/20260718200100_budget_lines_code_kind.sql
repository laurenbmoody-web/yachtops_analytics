-- Cargo Accounts — Phase 1.1. Bring budget_lines up to the standard yacht
-- management-accounts layout (per the owner's-office expenditure-analysis report):
--   code = the 3-letter account code (OCW, DCN, FLE, GFE, …), optional
--   kind = 'expense' (default) or 'revenue' (Net Charter Revenue, Reimbursements, …)
-- so a budget can hold both a REVENUE section and the coded expenditure groups, and
-- report a Net Revenue (Expenditure) figure. Idempotent (ADD COLUMN IF NOT EXISTS;
-- the inline CHECK is skipped on re-run because the column already exists).

ALTER TABLE public.budget_lines
  ADD COLUMN IF NOT EXISTS code text;

ALTER TABLE public.budget_lines
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'expense'
    CHECK (kind IN ('expense','revenue'));

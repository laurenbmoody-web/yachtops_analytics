-- Cargo Accounts — month-end close: how an account is funded, and the figures the
-- bank statement stated for the period.
--
-- Vessels fund differently and the close has to say something different for each:
--   imprest — a float at a set level, reimbursed monthly to restore it
--   prepaid — loaded up front and drawn down (Voly-style cards)
--   apa     — the charter advance, returned to the guest at the end of the charter
-- funding_model is optional: when unset it's inferred from funds_type (charter_apa →
-- apa, everything else → imprest), so existing accounts behave sensibly untouched.
--
-- The statement figures are stored on the reconciliation so the close is auditable:
-- these are what the BANK said, recorded alongside what Cargo computed. A month can
-- only be closed when they agree — nothing is ever plugged to force a balance.

ALTER TABLE public.financial_accounts
  ADD COLUMN IF NOT EXISTS funding_model text,
  ADD COLUMN IF NOT EXISTS float_target  numeric(14,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_accounts_funding_model_check') THEN
    ALTER TABLE public.financial_accounts
      ADD CONSTRAINT financial_accounts_funding_model_check
      CHECK (funding_model IS NULL OR funding_model IN ('imprest', 'prepaid', 'apa'));
  END IF;
END $$;

COMMENT ON COLUMN public.financial_accounts.funding_model IS
  'imprest | prepaid | apa. Null infers from funds_type (charter_apa → apa, else imprest).';
COMMENT ON COLUMN public.financial_accounts.float_target IS
  'For an imprest float: the level it is restored to, so the monthly top-up can be computed.';

-- What the bank statement stated for the period, recorded against the close.
ALTER TABLE public.account_reconciliations
  ADD COLUMN IF NOT EXISTS stmt_opening   numeric(14,2),
  ADD COLUMN IF NOT EXISTS stmt_money_in  numeric(14,2),
  ADD COLUMN IF NOT EXISTS stmt_money_out numeric(14,2),
  ADD COLUMN IF NOT EXISTS stmt_closing   numeric(14,2),
  ADD COLUMN IF NOT EXISTS funding_due    numeric(14,2);

COMMENT ON COLUMN public.account_reconciliations.stmt_money_out IS
  'Total money out per the bank statement for the period — the figure Cargo must match.';
COMMENT ON COLUMN public.account_reconciliations.funding_due IS
  'Derived at close: the top-up that restores an imprest float, or the APA balance to return.';

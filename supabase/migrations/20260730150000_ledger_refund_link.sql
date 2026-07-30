-- Cargo Accounts — refunds. A merchant refund arrives in the bank feed as its own
-- POSITIVE line from the same merchant. Left unlinked it reads as income, which
-- flatters the accounts twice over: the original spend stays overstated and the
-- refund inflates revenue.
--
-- Linking the refund to the spend it reverses lets both sit on the SAME MYBA line,
-- so the budget line nets down by the refunded amount — which is what actually
-- happened. The money movements both stay real (no voiding a bank line); it's only
-- the attribution that's corrected.

ALTER TABLE public.ledger_transactions
  ADD COLUMN IF NOT EXISTS refund_of_id uuid
    REFERENCES public.ledger_transactions(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.ledger_transactions.refund_of_id IS
  'For a refund line: the spend it reverses. Both carry the same category so the budget line nets down.';

CREATE INDEX IF NOT EXISTS idx_ledger_txn_refund_of
  ON public.ledger_transactions(refund_of_id) WHERE refund_of_id IS NOT NULL;

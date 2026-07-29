-- Cargo Accounts — a bank line genuinely has TWO dates, and we were keeping the
-- wrong one for accounting purposes.
--
--   • when it happened  — the crew tapped the card (Plaid `authorized_date`,
--     Enable Banking `transaction_date`/`value_date`). This is the date the cost
--     was INCURRED, so it decides which month's management accounts own it.
--   • when it landed    — the bank posted it to the statement (Plaid `date`,
--     Enable Banking `booking_date`). This is what you tie to a bank statement
--     when reconciling.
--
-- They differ constantly on cards (fuel and restaurants often post 1–3 days later,
-- weekends longer), and at a month boundary that difference moves a cost into the
-- wrong month. The sync was storing only the POSTED date in txn_date, so a 30 June
-- purchase that posted 2 July was landing in July.
--
-- After this migration:
--   txn_date       = when it happened  (the accounting date; what budgets/month-end use)
--   statement_date = when it landed    (the bank's date; what statement matching uses)
--
-- Also captures `is_pending`: a pending card authorisation can still change amount
-- or date when it settles, so it shouldn't be treated as final money.

ALTER TABLE public.ledger_transactions
  ADD COLUMN IF NOT EXISTS statement_date date,
  ADD COLUMN IF NOT EXISTS is_pending     boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ledger_transactions.txn_date IS
  'When the spend happened (accounting date) — drives month-end and budget-vs-actual.';
COMMENT ON COLUMN public.ledger_transactions.statement_date IS
  'When the bank posted it to the statement — used for bank reconciliation matching.';
COMMENT ON COLUMN public.ledger_transactions.is_pending IS
  'Bank feed authorisation not yet settled; amount/date may still change.';

-- Backfill: what we previously stored in txn_date for feed rows WAS the posted
-- date, so that is exactly what statement_date should be. We cannot recover the
-- true authorisation date for history — future syncs populate both correctly.
UPDATE public.ledger_transactions
   SET statement_date = txn_date
 WHERE statement_date IS NULL
   AND source = 'bank_feed';

CREATE INDEX IF NOT EXISTS idx_ledger_txn_statement_date
  ON public.ledger_transactions(tenant_id, statement_date)
  WHERE statement_date IS NOT NULL;

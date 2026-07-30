-- Cargo Accounts — separate the BANK's words from the CREW's words, and let a
-- charter be named when the vessel hasn't set up trips.
--
-- 1. `note` — the crew's own description of what the spend was for ("hydraulic hose
--    for the tender crane"). Previously the detail panel edited `description`, but
--    that column holds the BANK's narrative (Plaid's `tx.name` — the merchant), so
--    editing it overwrote feed data and, worse, offered to "change" a merchant name
--    that is by definition what the merchant is called. `description` is now
--    read-only feed data; `note` is the editable human memo.
--
-- 2. `charter_ref` — a typed charter name for when charter/APA spend has to be
--    attributed but the vessel has no trips recorded in Cargo yet. trip_id remains
--    the strong link (FK to trips); charter_ref is the free-text fallback so the
--    line can still be billed rather than being blocked by missing setup.

ALTER TABLE public.ledger_transactions
  ADD COLUMN IF NOT EXISTS note        text,
  ADD COLUMN IF NOT EXISTS charter_ref text;

COMMENT ON COLUMN public.ledger_transactions.description IS
  'The bank/source narrative (e.g. Plaid tx.name) — feed data, not user-editable.';
COMMENT ON COLUMN public.ledger_transactions.note IS
  'The crew''s own description of what the spend was for.';
COMMENT ON COLUMN public.ledger_transactions.charter_ref IS
  'Free-text charter name, when charter spend must be attributed but no trip record exists. trip_id is preferred.';

-- Splits get the same free-text charter fallback so a split part can be billed too.
ALTER TABLE public.ledger_transaction_splits
  ADD COLUMN IF NOT EXISTS charter_ref text;

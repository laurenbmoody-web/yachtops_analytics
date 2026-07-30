-- Cargo Accounts — some spend genuinely has no receipt.
--
-- A bank charge, a non-GBP transaction fee, a card subscription, a lost slip: there
-- is no piece of paper to attach, and never will be. Without a way to say so, those
-- lines sit permanently short of "evidenced" and the crew learn to ignore the flag —
-- which defeats the point of flagging anything.
--
-- Declaring it, with a reason, is the auditable answer: the line is complete, and the
-- owner's accountant can see exactly why no document exists rather than wondering
-- whether one was lost.

ALTER TABLE public.ledger_transactions
  ADD COLUMN IF NOT EXISTS receipt_waived        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receipt_waived_reason text;

COMMENT ON COLUMN public.ledger_transactions.receipt_waived IS
  'No receipt exists for this line (bank fee, subscription, lost slip) — declared, not missing.';
COMMENT ON COLUMN public.ledger_transactions.receipt_waived_reason IS
  'Why there is no receipt, for the audit trail.';

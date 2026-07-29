-- Cargo Accounts — reconciliation line detail. Two additions so a ledger line can
-- go from merely *coded* (has a MYBA category) to properly *reconciled*:
--
-- 1. `allocation` on ledger_transactions — is this spend billable to the CHARTER
--    guest (APA) or borne by the OWNER? This is what the owner statement hinges on.
--    A vessel with dedicated charter/APA cards gets it implied from the account's
--    funds_type; a vessel spending charter money on the ship's card must state it
--    per line, and then `trip_id` says WHICH charter.
--
-- 2. `ledger_transaction_splits` — one payment, several budget lines (a £2k
--    supermarket run that is part guest food, part crew food). Splits are an
--    ALLOCATION BREAKDOWN of the parent payment, deliberately NOT extra ledger
--    rows: balance math sums ledger_transactions.amount, so sibling rows would
--    double-count the money. The parent keeps the real cash movement; the splits
--    describe how to attribute it.
--
-- Everything else the reconcile panel needs already exists on ledger_transactions
-- (description, department, vat_amount, vat_rate, currency/fx_rate/amount_base,
-- crew_id → profiles for the cardholder, trip_id → trips) or in
-- ledger_transaction_attachments (receipts).

-- ── 1. Charter vs owner allocation ──────────────────────────────────────────
ALTER TABLE public.ledger_transactions
  ADD COLUMN IF NOT EXISTS allocation text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ledger_transactions_allocation_check'
  ) THEN
    ALTER TABLE public.ledger_transactions
      ADD CONSTRAINT ledger_transactions_allocation_check
      CHECK (allocation IS NULL OR allocation IN ('owner', 'charter'));
  END IF;
END $$;

COMMENT ON COLUMN public.ledger_transactions.allocation IS
  'Who bears this cost: owner | charter (APA). When charter, trip_id should name the charter.';

CREATE INDEX IF NOT EXISTS idx_ledger_txn_allocation
  ON public.ledger_transactions(tenant_id, allocation) WHERE allocation IS NOT NULL;

-- ── 2. Split allocations ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ledger_transaction_splits (
  id                     uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id              uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ledger_transaction_id  uuid        NOT NULL REFERENCES public.ledger_transactions(id) ON DELETE CASCADE,
  amount                 numeric(14,2) NOT NULL,      -- same sign convention as the parent
  category               text        NOT NULL,        -- MYBA line description
  category_code          text,                        -- 3-letter MYBA code
  department             text,
  trip_id                uuid        REFERENCES public.trips(id) ON DELETE SET NULL,
  allocation             text,
  note                   text,
  sort_order             integer     DEFAULT 0,
  created_by             uuid        REFERENCES auth.users(id),
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now(),
  CONSTRAINT ledger_transaction_splits_allocation_check
    CHECK (allocation IS NULL OR allocation IN ('owner', 'charter'))
);

CREATE INDEX IF NOT EXISTS idx_ledger_txn_splits_txn
  ON public.ledger_transaction_splits(ledger_transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_txn_splits_tenant
  ON public.ledger_transaction_splits(tenant_id);

CREATE OR REPLACE FUNCTION public.handle_ledger_txn_splits_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS set_ledger_txn_splits_updated_at ON public.ledger_transaction_splits;
CREATE TRIGGER set_ledger_txn_splits_updated_at BEFORE UPDATE ON public.ledger_transaction_splits
  FOR EACH ROW EXECUTE FUNCTION public.handle_ledger_txn_splits_updated_at();

ALTER TABLE public.ledger_transaction_splits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ledger_txn_splits_select" ON public.ledger_transaction_splits;
CREATE POLICY "ledger_txn_splits_select" ON public.ledger_transaction_splits FOR SELECT TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()));
DROP POLICY IF EXISTS "ledger_txn_splits_insert" ON public.ledger_transaction_splits;
CREATE POLICY "ledger_txn_splits_insert" ON public.ledger_transaction_splits FOR INSERT TO authenticated
  WITH CHECK (public.is_active_tenant_member(tenant_id, auth.uid()));
DROP POLICY IF EXISTS "ledger_txn_splits_update" ON public.ledger_transaction_splits;
CREATE POLICY "ledger_txn_splits_update" ON public.ledger_transaction_splits FOR UPDATE TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()))
  WITH CHECK (public.is_active_tenant_member(tenant_id, auth.uid()));
DROP POLICY IF EXISTS "ledger_txn_splits_delete" ON public.ledger_transaction_splits;
CREATE POLICY "ledger_txn_splits_delete" ON public.ledger_transaction_splits FOR DELETE TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()));

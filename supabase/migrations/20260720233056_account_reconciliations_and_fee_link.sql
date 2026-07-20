-- Cargo Accounts — month-end reconciliation submissions + FX-fee linkage.
--
-- (1) account_reconciliations: one row per account per calendar month. A holder
--     works their own card/float through the month, then submits it; Command
--     signs off (or bounces it back). Balances are snapshotted at submit so the
--     statement of the month is stable even as later months post.
--       status: open -> submitted -> approved  (or bounced back to open)
--
-- (2) ledger_transactions.fee_parent_id: a card/FX fee is its own transaction
--     tied to the charge it belongs to (issuer auto-records fees). The parent's
--     original currency + rate already live in amount/currency/fx_rate.

CREATE TABLE IF NOT EXISTS public.account_reconciliations (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id      uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id     uuid        NOT NULL REFERENCES public.financial_accounts(id) ON DELETE CASCADE,
  period_month   date        NOT NULL,   -- first day of the month being reconciled
  status         text        NOT NULL DEFAULT 'open'
                             CHECK (status IN ('open','submitted','approved')),
  opening_balance numeric(14,2),
  closing_balance numeric(14,2),
  note           text,
  submitted_by   uuid        REFERENCES auth.users(id),
  submitted_at   timestamptz,
  approved_by    uuid        REFERENCES auth.users(id),
  approved_at    timestamptz,
  created_by     uuid        REFERENCES auth.users(id),
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_account_reconciliations_period
  ON public.account_reconciliations(account_id, period_month);
CREATE INDEX IF NOT EXISTS idx_account_reconciliations_tenant
  ON public.account_reconciliations(tenant_id);

CREATE OR REPLACE FUNCTION public.handle_account_reconciliations_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS set_account_reconciliations_updated_at ON public.account_reconciliations;
CREATE TRIGGER set_account_reconciliations_updated_at
  BEFORE UPDATE ON public.account_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.handle_account_reconciliations_updated_at();

ALTER TABLE public.account_reconciliations ENABLE ROW LEVEL SECURITY;

-- Any active member may read/insert/update reconciliations for their tenant
-- (a holder works their own; Command reviews). App layer scopes a holder to
-- their own accounts; COMMAND-only sign-off is enforced in the service.
DROP POLICY IF EXISTS "account_reconciliations_select" ON public.account_reconciliations;
CREATE POLICY "account_reconciliations_select"
  ON public.account_reconciliations FOR SELECT TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()));

DROP POLICY IF EXISTS "account_reconciliations_insert" ON public.account_reconciliations;
CREATE POLICY "account_reconciliations_insert"
  ON public.account_reconciliations FOR INSERT TO authenticated
  WITH CHECK (public.is_active_tenant_member(tenant_id, auth.uid()));

DROP POLICY IF EXISTS "account_reconciliations_update" ON public.account_reconciliations;
CREATE POLICY "account_reconciliations_update"
  ON public.account_reconciliations FOR UPDATE TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()))
  WITH CHECK (public.is_active_tenant_member(tenant_id, auth.uid()));

DROP POLICY IF EXISTS "account_reconciliations_delete" ON public.account_reconciliations;
CREATE POLICY "account_reconciliations_delete"
  ON public.account_reconciliations FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = account_reconciliations.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active IS NOT FALSE
        AND tm.permission_tier = 'COMMAND')
  );

-- FX / card fee linkage: a fee transaction points at its parent charge.
ALTER TABLE public.ledger_transactions
  ADD COLUMN IF NOT EXISTS fee_parent_id uuid REFERENCES public.ledger_transactions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_transactions_fee_parent
  ON public.ledger_transactions(fee_parent_id) WHERE fee_parent_id IS NOT NULL;

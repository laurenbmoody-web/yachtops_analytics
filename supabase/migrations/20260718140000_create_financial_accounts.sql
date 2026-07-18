-- Cargo Accounts — Phase 0 (Financial Core).
-- financial_accounts: per-tenant bank / card / cash accounts, multi-currency.
--
-- Isolation is by tenant_id (matches every other module in this codebase, e.g.
-- provisioning per 20260325110000_fix_provisioning_use_tenant_id.sql). vessel_id is
-- an OPTIONAL attribution column (a tenant may own multiple vessels); it is never the
-- RLS boundary. RLS + updated_at-trigger pattern copied from the provisioning tables:
--   * is_active_tenant_member(tenant_id, auth.uid()) SECURITY DEFINER (20260207150715)
--   * DELETE restricted to permission_tier = 'COMMAND'
-- id default gen_random_uuid() to match current migrations (20260715+).
--
-- Balance is NOT stored: current balance = opening_balance + SUM(ledger_transactions.amount)
-- for the account, computed in the service layer (see financeService.js).

CREATE TABLE IF NOT EXISTS public.financial_accounts (
  id              uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       uuid          NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vessel_id       uuid          REFERENCES public.vessels(id) ON DELETE SET NULL,
  name            text          NOT NULL,
  kind            text          NOT NULL DEFAULT 'bank'
                                CHECK (kind IN ('bank','card','cash')),
  currency        text          NOT NULL DEFAULT 'EUR'
                                CHECK (currency IN ('EUR','GBP','USD')),
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  is_active       boolean       NOT NULL DEFAULT true,
  notes           text,
  created_by      uuid          REFERENCES auth.users(id),
  created_at      timestamptz   DEFAULT now(),
  updated_at      timestamptz   DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_accounts_tenant_id ON public.financial_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_financial_accounts_vessel_id ON public.financial_accounts(vessel_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at trigger (own function, per convention)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_financial_accounts_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_financial_accounts_updated_at ON public.financial_accounts;
CREATE TRIGGER set_financial_accounts_updated_at
  BEFORE UPDATE ON public.financial_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_financial_accounts_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.financial_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "financial_accounts_select" ON public.financial_accounts;
CREATE POLICY "financial_accounts_select"
  ON public.financial_accounts FOR SELECT TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()));

DROP POLICY IF EXISTS "financial_accounts_insert" ON public.financial_accounts;
CREATE POLICY "financial_accounts_insert"
  ON public.financial_accounts FOR INSERT TO authenticated
  WITH CHECK (public.is_active_tenant_member(tenant_id, auth.uid()));

DROP POLICY IF EXISTS "financial_accounts_update" ON public.financial_accounts;
CREATE POLICY "financial_accounts_update"
  ON public.financial_accounts FOR UPDATE TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()))
  WITH CHECK (public.is_active_tenant_member(tenant_id, auth.uid()));

DROP POLICY IF EXISTS "financial_accounts_delete" ON public.financial_accounts;
CREATE POLICY "financial_accounts_delete"
  ON public.financial_accounts FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id       = financial_accounts.tenant_id
        AND tm.user_id         = auth.uid()
        AND tm.active IS NOT FALSE
        AND tm.permission_tier = 'COMMAND'
    )
  );

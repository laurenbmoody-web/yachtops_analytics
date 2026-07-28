-- Cargo Accounts — live bank/card feed: connections + external account links.
-- A tenant connects an account provider (an Open Banking aggregator such as
-- GoCardless Bank Account Data, or a card program). Each connection exposes one or
-- more external accounts, which map to our financial_accounts. Transactions arrive
-- via a server-side edge function and post into ledger_transactions with
-- source='bank_feed' and external_txn_id for dedup.
--
-- SECURITY: no access tokens and no full account numbers are stored here. The
-- provider access token lives server-side in the edge function (using the app's
-- provider secret); we keep only connection metadata + an IBAN last-4 for display.

-- ── 1. connections ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bank_connections (
  id                uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         uuid          NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider          text          NOT NULL DEFAULT 'gocardless'
                                  CHECK (provider IN ('gocardless','truelayer','tink','saltedge','soldo','centtrip')),
  institution_id    text,
  institution_name  text,
  requisition_id    text,          -- provider's connection/consent reference
  reference         text,          -- our correlation id passed to the provider
  status            text          NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','linked','expired','error')),
  error_detail      text,
  created_by        uuid          REFERENCES auth.users(id),
  created_at        timestamptz   DEFAULT now(),
  updated_at        timestamptz   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_connections_tenant_id ON public.bank_connections(tenant_id);

-- ── 2. external accounts under a connection ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bank_connection_accounts (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  connection_id       uuid        NOT NULL REFERENCES public.bank_connections(id) ON DELETE CASCADE,
  external_account_id text        NOT NULL,   -- provider's account id
  account_id          uuid        REFERENCES public.financial_accounts(id) ON DELETE SET NULL, -- our mapped account
  display_name        text,
  iban_last4          text,       -- last 4 only; never the full IBAN/PAN
  currency            text,
  last_synced_at      timestamptz,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_connection_accounts_tenant_id     ON public.bank_connection_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bank_connection_accounts_connection_id ON public.bank_connection_accounts(connection_id);
CREATE INDEX IF NOT EXISTS idx_bank_connection_accounts_account_id    ON public.bank_connection_accounts(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_connection_accounts_ext
  ON public.bank_connection_accounts(connection_id, external_account_id);

-- ── 3. ledger: bank-feed source + dedup key ──────────────────────────────────
ALTER TABLE public.ledger_transactions ADD COLUMN IF NOT EXISTS external_txn_id text;

ALTER TABLE public.ledger_transactions DROP CONSTRAINT IF EXISTS ledger_transactions_source_check;
ALTER TABLE public.ledger_transactions ADD CONSTRAINT ledger_transactions_source_check
  CHECK (source IN ('manual','supplier_invoice','provisioning','defect_repair','charter','import','bank_feed'));

-- One posting per (account, provider transaction) — a bank line never double-posts.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_transactions_external
  ON public.ledger_transactions(account_id, external_txn_id)
  WHERE external_txn_id IS NOT NULL;

-- ── updated_at triggers (own function per convention) ────────────────────────
CREATE OR REPLACE FUNCTION public.handle_bank_connections_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS set_bank_connections_updated_at ON public.bank_connections;
CREATE TRIGGER set_bank_connections_updated_at
  BEFORE UPDATE ON public.bank_connections
  FOR EACH ROW EXECUTE FUNCTION public.handle_bank_connections_updated_at();

CREATE OR REPLACE FUNCTION public.handle_bank_connection_accounts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS set_bank_connection_accounts_updated_at ON public.bank_connection_accounts;
CREATE TRIGGER set_bank_connection_accounts_updated_at
  BEFORE UPDATE ON public.bank_connection_accounts
  FOR EACH ROW EXECUTE FUNCTION public.handle_bank_connection_accounts_updated_at();

-- ── Row Level Security ───────────────────────────────────────────────────────
-- SELECT: any active tenant member. INSERT/UPDATE/DELETE: COMMAND only (connecting
-- a bank is a Command action), matching chart_of_accounts.
ALTER TABLE public.bank_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_connection_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bank_connections_select" ON public.bank_connections;
CREATE POLICY "bank_connections_select" ON public.bank_connections FOR SELECT TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()));
DROP POLICY IF EXISTS "bank_connections_write" ON public.bank_connections;
CREATE POLICY "bank_connections_write" ON public.bank_connections FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = bank_connections.tenant_id AND tm.user_id = auth.uid()
      AND tm.active IS NOT FALSE AND tm.permission_tier = 'COMMAND'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = bank_connections.tenant_id AND tm.user_id = auth.uid()
      AND tm.active IS NOT FALSE AND tm.permission_tier = 'COMMAND'));

DROP POLICY IF EXISTS "bank_connection_accounts_select" ON public.bank_connection_accounts;
CREATE POLICY "bank_connection_accounts_select" ON public.bank_connection_accounts FOR SELECT TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()));
DROP POLICY IF EXISTS "bank_connection_accounts_write" ON public.bank_connection_accounts;
CREATE POLICY "bank_connection_accounts_write" ON public.bank_connection_accounts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = bank_connection_accounts.tenant_id AND tm.user_id = auth.uid()
      AND tm.active IS NOT FALSE AND tm.permission_tier = 'COMMAND'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = bank_connection_accounts.tenant_id AND tm.user_id = auth.uid()
      AND tm.active IS NOT FALSE AND tm.permission_tier = 'COMMAND'));

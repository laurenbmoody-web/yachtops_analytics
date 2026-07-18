-- Cargo Accounts — Phase 0 (Financial Core).
-- ledger_transactions: single-entry, signed-amount, operationally-tagged ledger.
--
-- Sign convention: amount > 0 = money IN to the account; amount < 0 = money OUT.
-- amount is in the account's currency; amount_base is converted to the tenant's
-- reporting currency via fx_rate (fx_rate = 1 when same currency).
--
-- Isolation by tenant_id (matches the app). vessel_id is optional attribution.
-- Operational tags (supplier_order_id, supplier_invoice_id, provisioning_item_id,
-- defect_id, trip_id, crew_id) are the integration moat — all nullable, set what
-- applies. posting_group_id is reserved for a future double-entry layer (always NULL
-- in Phase 0). RLS + updated_at pattern as per financial_accounts / provisioning.

CREATE TABLE IF NOT EXISTS public.ledger_transactions (
  id             uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id      uuid          NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vessel_id      uuid          REFERENCES public.vessels(id) ON DELETE SET NULL,
  account_id     uuid          REFERENCES public.financial_accounts(id) ON DELETE SET NULL,
  txn_date       date          NOT NULL DEFAULT (now()::date),
  amount         numeric(14,2) NOT NULL,
  currency       text          NOT NULL DEFAULT 'EUR',
  fx_rate        numeric(18,8) NOT NULL DEFAULT 1,
  amount_base    numeric(14,2) NOT NULL,
  category       text,
  description    text,
  source         text          NOT NULL DEFAULT 'manual'
                               CHECK (source IN (
                                 'manual','supplier_invoice','provisioning',
                                 'defect_repair','charter','import'
                               )),
  status         text          NOT NULL DEFAULT 'unreconciled'
                               CHECK (status IN ('unreconciled','reconciled','void')),

  -- Operational tags (all nullable; set what applies).
  supplier_order_id    uuid REFERENCES public.supplier_orders(id)    ON DELETE SET NULL,
  supplier_invoice_id  uuid REFERENCES public.supplier_invoices(id)  ON DELETE SET NULL,
  provisioning_item_id uuid REFERENCES public.provisioning_items(id) ON DELETE SET NULL,
  defect_id            uuid REFERENCES public.defects(id)            ON DELETE SET NULL,
  trip_id              uuid REFERENCES public.trips(id)              ON DELETE SET NULL,
  crew_id              uuid REFERENCES public.profiles(id)           ON DELETE SET NULL,

  posting_group_id uuid,          -- reserved for future double-entry; always NULL in Phase 0

  created_by     uuid          REFERENCES auth.users(id),
  created_at     timestamptz   DEFAULT now(),
  updated_at     timestamptz   DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_transactions_tenant_id           ON public.ledger_transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ledger_transactions_vessel_id           ON public.ledger_transactions(vessel_id);
CREATE INDEX IF NOT EXISTS idx_ledger_transactions_account_id          ON public.ledger_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_ledger_transactions_txn_date            ON public.ledger_transactions(txn_date);
CREATE INDEX IF NOT EXISTS idx_ledger_transactions_supplier_invoice_id ON public.ledger_transactions(supplier_invoice_id);
CREATE INDEX IF NOT EXISTS idx_ledger_transactions_trip_id             ON public.ledger_transactions(trip_id);

-- Idempotency backstop for the supplier-invoice auto-post hook (one paid posting per
-- invoice). Safe for Phase 0 (no partial-payment splits yet). Revisit if partial
-- payments arrive.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_transactions_supplier_invoice
  ON public.ledger_transactions(supplier_invoice_id)
  WHERE supplier_invoice_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at trigger (own function, per convention)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_ledger_transactions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_ledger_transactions_updated_at ON public.ledger_transactions;
CREATE TRIGGER set_ledger_transactions_updated_at
  BEFORE UPDATE ON public.ledger_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_ledger_transactions_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.ledger_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ledger_transactions_select" ON public.ledger_transactions;
CREATE POLICY "ledger_transactions_select"
  ON public.ledger_transactions FOR SELECT TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()));

DROP POLICY IF EXISTS "ledger_transactions_insert" ON public.ledger_transactions;
CREATE POLICY "ledger_transactions_insert"
  ON public.ledger_transactions FOR INSERT TO authenticated
  WITH CHECK (public.is_active_tenant_member(tenant_id, auth.uid()));

DROP POLICY IF EXISTS "ledger_transactions_update" ON public.ledger_transactions;
CREATE POLICY "ledger_transactions_update"
  ON public.ledger_transactions FOR UPDATE TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()))
  WITH CHECK (public.is_active_tenant_member(tenant_id, auth.uid()));

DROP POLICY IF EXISTS "ledger_transactions_delete" ON public.ledger_transactions;
CREATE POLICY "ledger_transactions_delete"
  ON public.ledger_transactions FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id       = ledger_transactions.tenant_id
        AND tm.user_id         = auth.uid()
        AND tm.active IS NOT FALSE
        AND tm.permission_tier = 'COMMAND'
    )
  );

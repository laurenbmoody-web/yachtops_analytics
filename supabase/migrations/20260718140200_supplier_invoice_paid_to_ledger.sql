-- Cargo Accounts — Phase 0 (Financial Core). Integration hook.
--
-- When a supplier_invoices row transitions into paid, post one matching money-OUT
-- ledger transaction, tagged to the invoice (+ its order). This lands spend already
-- flowing through Cargo in the ledger with no re-keying.
--
-- Confirmed against the live schema (supabase/migrations/20260419160000 + 20260428100300):
--   * paid signal: status = 'paid'. The app writes status + paid_at together via
--     markInvoicePaid() (src/pages/provisioning/utils/provisioningStorage.js). We fire
--     on the transition into status = 'paid'.
--   * tenant: supplier_invoices carries its own tenant_id — read NEW.tenant_id directly.
--     (supplier_orders has NO vessel_id; do not join through it.)
--   * gross: NEW.amount is the authoritative NOT NULL total the whole app reads.
--     Do NOT derive from subtotal + vat_breakdown (both nullable, filled only at PDF time).
--   * currency: use NEW.currency (invoices carry their own; do not hardcode 'EUR').
--   * supplier_invoices has no created_by column — omit it from the insert.
--
-- Idempotent: an EXISTS guard here plus the uq_ledger_transactions_supplier_invoice
-- unique index (20260718140100) ensure at most one posting per invoice.
--
-- Currency note: fx_rate is set to 1 and amount_base = amount. When NEW.currency differs
-- from the tenant reporting currency, amount_base is not yet correct — such rows surface
-- in the Ledger "Needs attention" queue (account_id IS NULL / unreconciled) for a manual
-- rate. A live FX feed is Phase 1+.

CREATE OR REPLACE FUNCTION public.post_supplier_invoice_to_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gross numeric(14,2);
BEGIN
  -- only act on the transition into paid
  IF (NEW.status = 'paid') AND (OLD.status IS DISTINCT FROM 'paid') THEN

    -- cannot scope safely without a tenant
    IF NEW.tenant_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- idempotency guard (the unique index is the hard backstop)
    IF EXISTS (SELECT 1 FROM public.ledger_transactions
               WHERE supplier_invoice_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    v_gross := COALESCE(NEW.amount, 0);

    IF v_gross <> 0 THEN
      INSERT INTO public.ledger_transactions
        (tenant_id, vessel_id, account_id, txn_date, amount, currency, fx_rate, amount_base,
         category, description, source, status, supplier_order_id, supplier_invoice_id)
      VALUES
        (NEW.tenant_id, NULL, NULL, COALESCE(NEW.paid_at::date, now()::date),
         -1 * v_gross, COALESCE(NEW.currency, 'EUR'), 1, -1 * v_gross,
         'provisioning', 'Auto: supplier invoice paid', 'supplier_invoice',
         'unreconciled', NEW.order_id, NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_supplier_invoice_to_ledger ON public.supplier_invoices;
CREATE TRIGGER trg_supplier_invoice_to_ledger
  AFTER UPDATE ON public.supplier_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.post_supplier_invoice_to_ledger();

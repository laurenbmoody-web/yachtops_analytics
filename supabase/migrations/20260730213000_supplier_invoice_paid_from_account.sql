-- Cargo Accounts — record WHERE a supplier invoice was paid from.
--
-- Until now markInvoicePaid() wrote status + paid_at and nothing else, so the
-- trigger below had no choice but to post the ledger line with account_id NULL.
-- Every paid invoice therefore landed in Spending as "Unassigned", and the crew
-- were asked, days later, to remember which card settled it — from a list of
-- eight accounts, three of which are called "Owner card".
--
-- The answer is known at the moment of payment and nowhere else, so that is where
-- it is now captured. Existing rows keep account_id NULL and still go through the
-- Assign flow; nothing is backfilled, because guessing would be worse than asking.
--
-- Card payments taken through Stripe Connect (public.supplier_payments) can fill
-- this in server-side once that checkout flow exists — the column is the same
-- landing place either way.

alter table public.supplier_invoices
  add column if not exists paid_from_account_id uuid
    references public.financial_accounts(id) on delete set null;

comment on column public.supplier_invoices.paid_from_account_id is
  'Which financial_account settled this invoice. Set when the invoice is marked paid; flows straight through to the posted ledger line.';

create index if not exists idx_supplier_invoices_paid_from
  on public.supplier_invoices(paid_from_account_id)
  where paid_from_account_id is not null;

-- Repost of 20260718170200 with the account carried through. A line that knows
-- its account is reconciled on arrival; one that doesn't still queues for Assign.
CREATE OR REPLACE FUNCTION public.post_supplier_invoice_to_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gross numeric(14,2);
  v_acct  uuid;
BEGIN
  IF (NEW.status = 'paid') AND (OLD.status IS DISTINCT FROM 'paid') THEN

    IF NEW.tenant_id IS NULL THEN
      RETURN NEW;
    END IF;

    IF EXISTS (SELECT 1 FROM public.ledger_transactions
               WHERE supplier_invoice_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    v_gross := COALESCE(NEW.amount, 0);

    -- Only honour an account belonging to the same tenant — a stale or foreign id
    -- must not silently post spend against another vessel's card.
    v_acct := NULL;
    IF NEW.paid_from_account_id IS NOT NULL THEN
      SELECT a.id INTO v_acct
      FROM public.financial_accounts a
      WHERE a.id = NEW.paid_from_account_id
        AND a.tenant_id = NEW.tenant_id;
    END IF;

    IF v_gross <> 0 THEN
      INSERT INTO public.ledger_transactions
        (tenant_id, account_id, txn_date, amount, currency, fx_rate, amount_base,
         category, description, source, status, supplier_order_id, supplier_invoice_id)
      VALUES
        (NEW.tenant_id, v_acct, COALESCE(NEW.paid_at::date, now()::date),
         -1 * v_gross, COALESCE(NEW.currency, 'EUR'), 1, -1 * v_gross,
         'provisioning', 'Auto: supplier invoice paid', 'supplier_invoice',
         CASE WHEN v_acct IS NULL THEN 'unreconciled' ELSE 'reconciled' END,
         NEW.order_id, NEW.id);
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

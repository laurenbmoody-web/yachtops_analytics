-- Foundation for invoice payment workflow. Sprint 10 will build on this
-- (mark-as-paid, payment-method UI, etc.). Sprint 9a only writes the
-- snapshot/breakdown columns at invoice generation time.

ALTER TABLE public.supplier_invoices
  ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'pending'
    CHECK (payment_method IN ('pending', 'manual_transfer', 'auto_transfer', 'card', 'other')),
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS line_items_snapshot jsonb DEFAULT '[]'::jsonb,
  -- frozen copy of line items at invoice time, for historical accuracy
  ADD COLUMN IF NOT EXISTS subtotal numeric(10,2),
  ADD COLUMN IF NOT EXISTS vat_breakdown jsonb DEFAULT '[]'::jsonb,
  -- [{category_key, label, rate, taxable_amount, vat_amount}]
  ADD COLUMN IF NOT EXISTS bonded_supply boolean DEFAULT false;

COMMENT ON COLUMN public.supplier_invoices.line_items_snapshot IS
  'Frozen line items at the time the invoice was generated. Historical accuracy.';
COMMENT ON COLUMN public.supplier_invoices.vat_breakdown IS
  'Per-category VAT summary used to render the totals block on the PDF.';

-- Cargo Accounts — Phase 1. budget_lines: two-level budget structure.
--   bucket   = the headline heading (e.g. 'Provisioning', 'Maintenance', 'Berthing')
--   category = the breakdown line within the bucket (e.g. 'Galley food', 'Beverages')
-- Budgeted money is split across the breakdown lines; the bucket subtotal and the
-- grand total are rolled up read-side. actual/committed are never stored — they are
-- computed live from ledger_transactions (actual) and open supplier_orders (committed).
--
-- No tenant_id column — tenant is resolved via budget_id -> budgets (child-table RLS,
-- same pattern as provisioning_items through provisioning_lists).

CREATE TABLE IF NOT EXISTS public.budget_lines (
  id           uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  budget_id    uuid          NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  bucket       text          NOT NULL,      -- headline heading
  category     text          NOT NULL,      -- breakdown line; matches ledger_transactions.category
  amount       numeric(14,2) NOT NULL DEFAULT 0,   -- budgeted, in the budget's currency
  notes        text,
  created_at   timestamptz   DEFAULT now(),
  updated_at   timestamptz   DEFAULT now(),
  CONSTRAINT budget_lines_unique_line UNIQUE (budget_id, bucket, category)
);

CREATE INDEX IF NOT EXISTS idx_budget_lines_budget_id ON public.budget_lines(budget_id);

CREATE OR REPLACE FUNCTION public.handle_budget_lines_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS set_budget_lines_updated_at ON public.budget_lines;
CREATE TRIGGER set_budget_lines_updated_at
  BEFORE UPDATE ON public.budget_lines
  FOR EACH ROW EXECUTE FUNCTION public.handle_budget_lines_updated_at();

ALTER TABLE public.budget_lines ENABLE ROW LEVEL SECURITY;

-- Resolve tenant via parent budget. DELETE = COMMAND only (join through budgets).
DROP POLICY IF EXISTS "budget_lines_select" ON public.budget_lines;
CREATE POLICY "budget_lines_select" ON public.budget_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.budgets b
    WHERE b.id = budget_lines.budget_id
      AND public.is_active_tenant_member(b.tenant_id, auth.uid())));
DROP POLICY IF EXISTS "budget_lines_insert" ON public.budget_lines;
CREATE POLICY "budget_lines_insert" ON public.budget_lines FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.budgets b
    WHERE b.id = budget_lines.budget_id
      AND public.is_active_tenant_member(b.tenant_id, auth.uid())));
DROP POLICY IF EXISTS "budget_lines_update" ON public.budget_lines;
CREATE POLICY "budget_lines_update" ON public.budget_lines FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.budgets b
    WHERE b.id = budget_lines.budget_id
      AND public.is_active_tenant_member(b.tenant_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.budgets b
    WHERE b.id = budget_lines.budget_id
      AND public.is_active_tenant_member(b.tenant_id, auth.uid())));
DROP POLICY IF EXISTS "budget_lines_delete" ON public.budget_lines;
CREATE POLICY "budget_lines_delete" ON public.budget_lines FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.budgets b
    JOIN public.tenant_members tm ON tm.tenant_id = b.tenant_id
    WHERE b.id = budget_lines.budget_id AND tm.user_id = auth.uid()
      AND tm.active IS NOT FALSE AND tm.permission_tier = 'COMMAND'));

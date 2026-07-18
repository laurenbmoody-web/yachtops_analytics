-- Cargo Accounts — Phase 1 (Budgets & budget-vs-actual).
-- budgets: a named spending plan for a period, per tenant (a vessel IS a tenant, 1:1).
-- Conventions per corrected Phase 0: tenant_id-only scoping, gen_random_uuid,
-- is_active_tenant_member RLS with COMMAND-only DELETE, per-table updated_at trigger.

CREATE TABLE IF NOT EXISTS public.budgets (
  id            uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     uuid          NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name          text          NOT NULL,
  period_start  date          NOT NULL,
  period_end    date          NOT NULL,
  currency      text          NOT NULL DEFAULT 'EUR'
                              CHECK (currency IN ('EUR','GBP','USD')),
  status        text          NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','active','closed')),
  notes         text,
  created_by    uuid          REFERENCES auth.users(id),
  created_at    timestamptz   DEFAULT now(),
  updated_at    timestamptz   DEFAULT now(),
  CONSTRAINT budgets_period_valid CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_budgets_tenant_id ON public.budgets(tenant_id);

CREATE OR REPLACE FUNCTION public.handle_budgets_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS set_budgets_updated_at ON public.budgets;
CREATE TRIGGER set_budgets_updated_at
  BEFORE UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.handle_budgets_updated_at();

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "budgets_select" ON public.budgets;
CREATE POLICY "budgets_select" ON public.budgets FOR SELECT TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()));
DROP POLICY IF EXISTS "budgets_insert" ON public.budgets;
CREATE POLICY "budgets_insert" ON public.budgets FOR INSERT TO authenticated
  WITH CHECK (public.is_active_tenant_member(tenant_id, auth.uid()));
DROP POLICY IF EXISTS "budgets_update" ON public.budgets;
CREATE POLICY "budgets_update" ON public.budgets FOR UPDATE TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()))
  WITH CHECK (public.is_active_tenant_member(tenant_id, auth.uid()));
DROP POLICY IF EXISTS "budgets_delete" ON public.budgets;
CREATE POLICY "budgets_delete" ON public.budgets FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = budgets.tenant_id AND tm.user_id = auth.uid()
      AND tm.active IS NOT FALSE AND tm.permission_tier = 'COMMAND'));

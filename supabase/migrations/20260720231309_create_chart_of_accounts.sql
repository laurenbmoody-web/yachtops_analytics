-- Cargo Accounts — tenant-configurable Chart of Accounts.
-- Categories are NOT hard-coded to MYBA. Each vessel (tenant) owns its own chart:
-- at setup they either apply the standard template, import their existing scheme,
-- or start fresh. Everything that categorises money — ledger transactions, budget
-- lines, reconcile "add to ledger" — reads the line labels from here.
--
-- Two-level model (matches how every yacht-mgmt system works: Voly, Latitude, etc.):
--   bucket   = the group heading (e.g. "Guest Costs", "Crew Cost")
--   category = the specific line under it (e.g. "Guest Wine Stock"), with an
--              optional short code. The bucket is derived from the line — it is
--              the dropdown's grouping, never chosen separately.
--
-- Isolation by tenant_id; RLS + updated_at-trigger pattern copied from
-- financial_accounts (20260718170000). SELECT for any active member (a holder
-- must be able to read categories to categorise their own card). INSERT/UPDATE/
-- DELETE are COMMAND-only — the chart is vessel configuration owned by Command.

CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bucket       text        NOT NULL,
  code         text,
  category     text        NOT NULL,
  kind         text        NOT NULL DEFAULT 'expense'
                           CHECK (kind IN ('revenue','expense')),
  sort_order   integer     NOT NULL DEFAULT 0,
  is_active    boolean     NOT NULL DEFAULT true,
  created_by   uuid        REFERENCES auth.users(id),
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_tenant_id ON public.chart_of_accounts(tenant_id);
-- One line label per bucket per tenant; one code per tenant when a code is used.
CREATE UNIQUE INDEX IF NOT EXISTS uq_chart_of_accounts_line
  ON public.chart_of_accounts(tenant_id, bucket, lower(category));
CREATE UNIQUE INDEX IF NOT EXISTS uq_chart_of_accounts_code
  ON public.chart_of_accounts(tenant_id, code) WHERE code IS NOT NULL;

-- ─── updated_at trigger (own function, per convention) ───────────────────────
CREATE OR REPLACE FUNCTION public.handle_chart_of_accounts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_chart_of_accounts_updated_at ON public.chart_of_accounts;
CREATE TRIGGER set_chart_of_accounts_updated_at
  BEFORE UPDATE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.handle_chart_of_accounts_updated_at();

-- ─── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chart_of_accounts_select" ON public.chart_of_accounts;
CREATE POLICY "chart_of_accounts_select"
  ON public.chart_of_accounts FOR SELECT TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()));

DROP POLICY IF EXISTS "chart_of_accounts_insert" ON public.chart_of_accounts;
CREATE POLICY "chart_of_accounts_insert"
  ON public.chart_of_accounts FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = chart_of_accounts.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active IS NOT FALSE
        AND tm.permission_tier = 'COMMAND')
  );

DROP POLICY IF EXISTS "chart_of_accounts_update" ON public.chart_of_accounts;
CREATE POLICY "chart_of_accounts_update"
  ON public.chart_of_accounts FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = chart_of_accounts.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active IS NOT FALSE
        AND tm.permission_tier = 'COMMAND')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = chart_of_accounts.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active IS NOT FALSE
        AND tm.permission_tier = 'COMMAND')
  );

DROP POLICY IF EXISTS "chart_of_accounts_delete" ON public.chart_of_accounts;
CREATE POLICY "chart_of_accounts_delete"
  ON public.chart_of_accounts FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = chart_of_accounts.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active IS NOT FALSE
        AND tm.permission_tier = 'COMMAND')
  );

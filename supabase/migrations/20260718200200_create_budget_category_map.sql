-- Cargo Accounts — Phase 1.2. budget_category_map: a per-vessel learned mapping from
-- a source spend category (e.g. a fine provisioning category like 'Wine, Champagne &
-- Fortified', or the free-text ledger category) to a budget line (bucket + category).
--
-- The budget-vs-actual resolver routes spend using: this override first, then a
-- context-aware classifier (confident guesses only), else Unbudgeted (the review
-- queue). When a user corrects an Unbudgeted row via the dropdown, that choice is
-- written here so the same category auto-routes everywhere next time.
--
-- Tenant-scoped (vessel = tenant). source_category is stored normalised (trimmed,
-- lower-case) so matching is case-insensitive and the unique key is stable.

CREATE TABLE IF NOT EXISTS public.budget_category_map (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_category text        NOT NULL,        -- normalised (trim + lower)
  bucket          text        NOT NULL,        -- target budget line bucket
  category        text        NOT NULL,        -- target budget line category
  code            text,
  created_by      uuid        REFERENCES auth.users(id),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  CONSTRAINT budget_category_map_unique UNIQUE (tenant_id, source_category)
);

CREATE INDEX IF NOT EXISTS idx_budget_category_map_tenant ON public.budget_category_map(tenant_id);

CREATE OR REPLACE FUNCTION public.handle_budget_category_map_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS set_budget_category_map_updated_at ON public.budget_category_map;
CREATE TRIGGER set_budget_category_map_updated_at BEFORE UPDATE ON public.budget_category_map
  FOR EACH ROW EXECUTE FUNCTION public.handle_budget_category_map_updated_at();

ALTER TABLE public.budget_category_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "budget_category_map_select" ON public.budget_category_map;
CREATE POLICY "budget_category_map_select" ON public.budget_category_map FOR SELECT TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()));
DROP POLICY IF EXISTS "budget_category_map_insert" ON public.budget_category_map;
CREATE POLICY "budget_category_map_insert" ON public.budget_category_map FOR INSERT TO authenticated
  WITH CHECK (public.is_active_tenant_member(tenant_id, auth.uid()));
DROP POLICY IF EXISTS "budget_category_map_update" ON public.budget_category_map;
CREATE POLICY "budget_category_map_update" ON public.budget_category_map FOR UPDATE TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()))
  WITH CHECK (public.is_active_tenant_member(tenant_id, auth.uid()));
DROP POLICY IF EXISTS "budget_category_map_delete" ON public.budget_category_map;
CREATE POLICY "budget_category_map_delete" ON public.budget_category_map FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = budget_category_map.tenant_id AND tm.user_id = auth.uid()
      AND tm.active IS NOT FALSE AND tm.permission_tier = 'COMMAND'));

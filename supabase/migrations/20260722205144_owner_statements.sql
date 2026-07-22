-- Cargo Accounts — Phase 3 (Owner reporting). owner_statements: a periodic,
-- formatted, exportable statement of the vessel's position, SNAPSHOTTED at issue
-- so an issued statement never silently changes as later ledger edits post.
--   status: draft -> issued. On issue, snapshot holds the frozen statement JSON.
-- Everything else in Phase 3 is read-side aggregation reusing the budget services.
-- RLS + trigger pattern mirrors financial_accounts (20260718170000).

CREATE TABLE IF NOT EXISTS public.owner_statements (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title         text NOT NULL,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  currency      text NOT NULL DEFAULT 'EUR',
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued')),
  snapshot      jsonb,
  note          text,
  issued_at     timestamptz,
  issued_by     uuid REFERENCES auth.users(id),
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  CONSTRAINT owner_statements_period_valid CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_owner_statements_tenant ON public.owner_statements(tenant_id);

CREATE OR REPLACE FUNCTION public.handle_owner_statements_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS set_owner_statements_updated_at ON public.owner_statements;
CREATE TRIGGER set_owner_statements_updated_at
  BEFORE UPDATE ON public.owner_statements
  FOR EACH ROW EXECUTE FUNCTION public.handle_owner_statements_updated_at();

ALTER TABLE public.owner_statements ENABLE ROW LEVEL SECURITY;

-- Active tenant members read (incl. the future owner/viewer, who is a member);
-- COMMAND-only delete. Insert/update by active members (app gates to COMMAND).
DROP POLICY IF EXISTS "owner_statements_select" ON public.owner_statements;
CREATE POLICY "owner_statements_select"
  ON public.owner_statements FOR SELECT TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()));

DROP POLICY IF EXISTS "owner_statements_insert" ON public.owner_statements;
CREATE POLICY "owner_statements_insert"
  ON public.owner_statements FOR INSERT TO authenticated
  WITH CHECK (public.is_active_tenant_member(tenant_id, auth.uid()));

DROP POLICY IF EXISTS "owner_statements_update" ON public.owner_statements;
CREATE POLICY "owner_statements_update"
  ON public.owner_statements FOR UPDATE TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()))
  WITH CHECK (public.is_active_tenant_member(tenant_id, auth.uid()));

DROP POLICY IF EXISTS "owner_statements_delete" ON public.owner_statements;
CREATE POLICY "owner_statements_delete"
  ON public.owner_statements FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = owner_statements.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active IS NOT FALSE
        AND tm.permission_tier = 'COMMAND')
  );

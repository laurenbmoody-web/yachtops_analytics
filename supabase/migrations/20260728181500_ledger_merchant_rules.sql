-- Cargo Accounts — Bank-feed merchant intelligence. ledger_merchant_rules: a
-- per-vessel learned mapping from a bank counterparty (merchant / payee) to a MYBA
-- chart line, so the live Enable Banking feed can be categorised automatically.
--
-- The feed hands us only a payee + free-text description (no bank-provided
-- category), so the merchant name is the primary signal. The suggestion engine
-- (src/services/merchantClassify.js) resolves each line by: this learned rule
-- first (authoritative), then a seed dictionary of known marine vendors, then a
-- description keyword pass. When Command files an un-categorised line, that choice
-- is written here so every future charge from the same merchant auto-files.
--
-- Tenant-scoped (vessel = tenant). merchant_key is stored normalised (legal
-- suffixes / branch / card noise stripped, trimmed, lower-case — see
-- normalizeMerchant) so matching is stable across charges from the same vendor.

CREATE TABLE IF NOT EXISTS public.ledger_merchant_rules (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  merchant_key text        NOT NULL,        -- normalised counterparty key
  bucket       text        NOT NULL,        -- target MYBA line bucket
  category     text        NOT NULL,        -- target MYBA line category
  code         text,                        -- 3-letter MYBA code
  created_by   uuid        REFERENCES auth.users(id),
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  CONSTRAINT ledger_merchant_rules_unique UNIQUE (tenant_id, merchant_key)
);

CREATE INDEX IF NOT EXISTS idx_ledger_merchant_rules_tenant ON public.ledger_merchant_rules(tenant_id);

CREATE OR REPLACE FUNCTION public.handle_ledger_merchant_rules_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS set_ledger_merchant_rules_updated_at ON public.ledger_merchant_rules;
CREATE TRIGGER set_ledger_merchant_rules_updated_at BEFORE UPDATE ON public.ledger_merchant_rules
  FOR EACH ROW EXECUTE FUNCTION public.handle_ledger_merchant_rules_updated_at();

ALTER TABLE public.ledger_merchant_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ledger_merchant_rules_select" ON public.ledger_merchant_rules;
CREATE POLICY "ledger_merchant_rules_select" ON public.ledger_merchant_rules FOR SELECT TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()));
DROP POLICY IF EXISTS "ledger_merchant_rules_insert" ON public.ledger_merchant_rules;
CREATE POLICY "ledger_merchant_rules_insert" ON public.ledger_merchant_rules FOR INSERT TO authenticated
  WITH CHECK (public.is_active_tenant_member(tenant_id, auth.uid()));
DROP POLICY IF EXISTS "ledger_merchant_rules_update" ON public.ledger_merchant_rules;
CREATE POLICY "ledger_merchant_rules_update" ON public.ledger_merchant_rules FOR UPDATE TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()))
  WITH CHECK (public.is_active_tenant_member(tenant_id, auth.uid()));
DROP POLICY IF EXISTS "ledger_merchant_rules_delete" ON public.ledger_merchant_rules;
CREATE POLICY "ledger_merchant_rules_delete" ON public.ledger_merchant_rules FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = ledger_merchant_rules.tenant_id AND tm.user_id = auth.uid()
      AND tm.active IS NOT FALSE AND tm.permission_tier = 'COMMAND'));

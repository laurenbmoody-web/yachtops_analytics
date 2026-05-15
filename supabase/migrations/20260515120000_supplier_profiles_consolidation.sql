-- ============================================================
-- supplier_profiles consolidation — Sprint 9c.3 Phase 2
-- ============================================================
--
-- Single all-or-nothing transaction. Adds tenant_id + vendor-model
-- columns, backfills the one existing row, migrates the 5 legacy
-- provisioning_suppliers rows in, wires provisioning_lists to the new
-- profile ids, and rewrites the crew RLS policies to close the
-- cross-tenant read leak (crew_read_supplier_profiles previously
-- returned every tenant's rows to any authenticated member).
--
-- NOT done here (rollback safety / follow-up sprint):
--   - provisioning_suppliers table is NOT dropped
--   - provisioning_lists.supplier_id column is NOT dropped
--
-- Supplier-portal policies are intentionally left untouched:
--   - supplier_read_own_profile
--   - supplier_update_own_profile
--   - anon_read_supplier_profiles (signup flow, intentionally public)
--
-- TODO: supplier_profiles is dual-purpose (vessel-side vendor directory
-- + supplier-portal self-signup). Portal-registered suppliers have no
-- vessel tenant_id, which is why tenant_id is NULLABLE here. Future
-- backlog: design a supplier_vessel_relationships table (many-to-many)
-- so a supplier can be in multiple vessel directories AND
-- self-registered without a tenant_id. Until then, NULL tenant_id is
-- the signal for "portal-registered, not yet claimed by a vessel."
--
-- ⚠ Pre-apply caveat — see the Claude Code report accompanying this
--   file. One assumption this migration bakes in:
--     provisioning_suppliers.department is text[] (Step 3 COALESCEs it
--     into the categories text[] column). If it is plain text the whole
--     transaction rolls back cleanly — verify the column type in Studio
--     before applying (Step 3 has a text-fallback variant ready).
-- ============================================================

BEGIN;

-- ─── Step 1: new columns ─────────────────────────────────────
ALTER TABLE public.supplier_profiles
  ADD COLUMN IF NOT EXISTS tenant_id        uuid REFERENCES public.tenants(id),
  ADD COLUMN IF NOT EXISTS vendor_type      text NOT NULL DEFAULT 'Supplier',
  ADD COLUMN IF NOT EXISTS subcategories    text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS primary_category text,
  ADD COLUMN IF NOT EXISTS is_favourite     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at      timestamptz;

ALTER TABLE public.supplier_profiles
  DROP CONSTRAINT IF EXISTS supplier_profiles_vendor_type_check;
ALTER TABLE public.supplier_profiles
  ADD CONSTRAINT supplier_profiles_vendor_type_check
  CHECK (vendor_type IN ('Supplier', 'Service Provider', 'Contractor', 'Agent', 'Broker'));

-- ─── Step 2: backfill tenant_id on existing row(s) ───────────
-- Phase 1 showed exactly 1 pre-existing supplier_profiles row; it
-- belongs to Lauren's tenant.
UPDATE public.supplier_profiles
SET tenant_id = 'de051fc7-ec3b-4c22-96e8-b9834acda6aa'
WHERE tenant_id IS NULL;

-- ─── Step 3: migrate legacy provisioning_suppliers rows ──────
INSERT INTO public.supplier_profiles (
  tenant_id, name, contact_email, contact_phone,
  business_city, categories, notes,
  vendor_type, created_at, updated_at
)
SELECT
  ps.tenant_id,
  ps.name,
  ps.email,
  ps.phone,
  ps.port_location,                       -- legacy port_location → business_city (coarse; better mapping deferred)
  COALESCE(ps.department, '{}'::text[]),   -- legacy department → categories[]
  ps.notes,
  'Supplier',
  ps.created_at,
  now()
FROM public.provisioning_suppliers ps
WHERE NOT EXISTS (
  SELECT 1 FROM public.supplier_profiles sp
  WHERE sp.tenant_id = ps.tenant_id
    AND lower(trim(sp.name)) = lower(trim(ps.name))
);

-- ─── Step 4: legacy → new UUID mapping (temp, txn-scoped) ────
CREATE TEMP TABLE supplier_id_mapping AS
SELECT
  ps.id AS legacy_id,
  sp.id AS profile_id
FROM public.provisioning_suppliers ps
JOIN public.supplier_profiles sp
  ON sp.tenant_id = ps.tenant_id
 AND lower(trim(sp.name)) = lower(trim(ps.name));

-- ─── Step 5: provisioning_lists.supplier_profile_id ──────────
ALTER TABLE public.provisioning_lists
  ADD COLUMN IF NOT EXISTS supplier_profile_id uuid REFERENCES public.supplier_profiles(id);

UPDATE public.provisioning_lists pl
SET supplier_profile_id = m.profile_id
FROM supplier_id_mapping m
WHERE pl.supplier_id = m.legacy_id
  AND pl.supplier_profile_id IS NULL;

-- ─── Step 6: (removed) ───────────────────────────────────────
-- tenant_id is intentionally left NULLABLE — see the dual-purpose
-- TODO in the header. RLS (Step 7) is the security boundary; a
-- NULL-tenant portal row matches no crew tenant filter, which is the
-- correct behaviour.

-- ─── Step 7: RLS rewrite — close the cross-tenant leak ───────
DROP POLICY IF EXISTS crew_read_supplier_profiles ON public.supplier_profiles;
CREATE POLICY crew_read_supplier_profiles ON public.supplier_profiles
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.active = true
    )
  );

DROP POLICY IF EXISTS crew_update_supplier_notes ON public.supplier_profiles;
DROP POLICY IF EXISTS crew_update_supplier_profiles ON public.supplier_profiles;
CREATE POLICY crew_update_supplier_profiles ON public.supplier_profiles
  FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.active = true
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.active = true
    )
  );

DROP POLICY IF EXISTS authenticated_insert_supplier_profiles ON public.supplier_profiles;
DROP POLICY IF EXISTS crew_insert_supplier_profiles ON public.supplier_profiles;
CREATE POLICY crew_insert_supplier_profiles ON public.supplier_profiles
  FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.active = true
    )
  );

-- DROP IF EXISTS added for CI-replay idempotency (deviation from the
-- brief's SQL — the brief omitted the guard; every other policy here
-- has one, matching the 9c.2 migration pattern).
DROP POLICY IF EXISTS crew_delete_supplier_profiles ON public.supplier_profiles;
CREATE POLICY crew_delete_supplier_profiles ON public.supplier_profiles
  FOR DELETE
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.active = true
    )
  );

-- ─── Step 8: column-level GRANTs ─────────────────────────────
GRANT UPDATE (vendor_type, subcategories, primary_category, is_favourite, archived_at, categories)
  ON public.supplier_profiles TO authenticated;

-- ─── Step 9: commit ──────────────────────────────────────────
COMMIT;

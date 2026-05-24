-- ============================================================
-- get_portal_enabled_suppliers — SECURITY DEFINER RPC
--
-- Hotfix for the Part 2 portal-routing chain. The crew-side
-- query in fetchPortalEnabledSuppliers needed to read
-- supplier_contacts to determine which suppliers had active
-- Cargo portal accounts (active = true AND user_id IS NOT NULL).
-- But supplier_contacts has exactly one SELECT policy
-- (supplier_read_team_contacts, migration 20260427130000):
--   USING (supplier_id = public.get_user_supplier_id())
-- For crew callers, get_user_supplier_id() returns NULL, so the
-- predicate is always false and the query returned an empty
-- array — with NO error. fetchPortalEnabledSuppliers ended up
-- with an empty Map, every group rendered the slip-flow path,
-- and Source and Supply's portal button never appeared.
--
-- Two options to fix:
--   (A) Add a broad crew_read_supplier_contacts SELECT policy
--       on supplier_contacts. REJECTED — would expose every
--       supplier's contact emails, internal team structure,
--       invite history, permission tiers across the entire DB
--       to anyone in any vessel tenant. Big info disclosure
--       for a tiny boolean question.
--   (B) Narrow SECURITY DEFINER RPC that returns ONLY the
--       (supplier_id, supplier_name) pairs the caller asked
--       about. CHOSEN — surgical exposure, no row leakage.
--
-- The returned supplier_name is already readable to crew via
-- the existing crew_read_supplier_profiles policy on
-- supplier_profiles, so this RPC doesn't disclose anything
-- new — it just answers the boolean "is this supplier
-- portal-enabled" for the ids the caller passed in.
--
-- SET search_path = public, pg_temp is the standard
-- SECURITY DEFINER hygiene — pins schema resolution to the
-- intended schemas so a hostile search_path can't redirect
-- the table refs.
--
-- Idempotent (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_portal_enabled_suppliers(p_supplier_ids uuid[])
RETURNS TABLE (supplier_id uuid, supplier_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT sc.supplier_id, sp.name AS supplier_name
  FROM   supplier_contacts sc
  JOIN   supplier_profiles sp ON sp.id = sc.supplier_id
  WHERE  sc.supplier_id = ANY(p_supplier_ids)
    AND  sc.active = true
    AND  sc.user_id IS NOT NULL;
$$;

GRANT EXECUTE
  ON FUNCTION public.get_portal_enabled_suppliers(uuid[])
  TO authenticated;

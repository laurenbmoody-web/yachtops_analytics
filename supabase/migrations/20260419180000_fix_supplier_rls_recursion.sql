-- Fix recursive/cross-table RLS policies that silently return no rows.
--
-- supplier_read_own_contacts used a self-referential EXISTS subquery on
-- supplier_contacts from within its own RLS policy, causing Postgres to
-- recursively apply RLS and return nothing. Replace with a direct uid check.
--
-- supplier_read_own_profile used EXISTS on supplier_contacts (RLS-protected),
-- which failed when the contacts policy was broken. Replace with the
-- SECURITY DEFINER helper function which bypasses RLS safely.

-- ── supplier_contacts ────────────────────────────────────────────────
DROP POLICY IF EXISTS "supplier_read_own_contacts" ON public.supplier_contacts;

CREATE POLICY "supplier_read_own_contacts" ON public.supplier_contacts
  FOR SELECT USING (user_id = auth.uid());

-- ── supplier_profiles ────────────────────────────────────────────────
DROP POLICY IF EXISTS "supplier_read_own_profile" ON public.supplier_profiles;

CREATE POLICY "supplier_read_own_profile" ON public.supplier_profiles
  FOR SELECT USING (id = public.get_user_supplier_id());

-- ── supplier_update_own_profile ──────────────────────────────────────
-- Also fix the update policy to use the helper (same pattern).
DROP POLICY IF EXISTS "supplier_update_own_profile" ON public.supplier_profiles;

CREATE POLICY "supplier_update_own_profile" ON public.supplier_profiles
  FOR UPDATE USING (id = public.get_user_supplier_id());

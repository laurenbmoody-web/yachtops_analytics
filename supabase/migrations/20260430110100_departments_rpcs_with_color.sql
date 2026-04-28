-- Migration: Update get_tenant_departments + get_all_departments to
-- return the color column.
--
-- Phase 1 follow-up. Both RPCs were defined to return TABLE(id UUID, name TEXT)
-- in 20260227140000 / 20260309220000 / 20260310110000. Adding `color text` as
-- a third column keeps the existing callers (which destructure { id, name })
-- working — they'll just ignore the new field — while letting the refactored
-- fetchVesselDepartments helper return { id, name, color }[] without a
-- separate lookup.
--
-- Both functions are CREATE OR REPLACE so re-running is safe. SECURITY DEFINER
-- + search_path locked, mirroring the existing definitions. GRANT re-issued
-- because Postgres drops privileges when the return signature changes.

-- ── get_tenant_departments ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_tenant_departments(p_tenant_id UUID)
RETURNS TABLE(id UUID, name TEXT, color TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify the calling user is a member of this tenant.
  -- active IS NOT FALSE handles NULL active values per 20260310110000.
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = p_tenant_id
      AND user_id   = auth.uid()
      AND (active IS NOT FALSE)
  ) THEN
    RAISE EXCEPTION 'Access denied: not a member of this tenant';
  END IF;

  RETURN QUERY
  SELECT d.id, d.name, d.color
  FROM public.departments d
  ORDER BY d.name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_tenant_departments(UUID) TO authenticated;

-- ── get_all_departments ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_all_departments()
RETURNS TABLE(id UUID, name TEXT, color TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT d.id, d.name, d.color
  FROM public.departments d
  ORDER BY d.name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_departments() TO authenticated;

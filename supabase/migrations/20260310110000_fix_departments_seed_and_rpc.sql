-- Migration: Fix departments seed + RPC active=true bug
-- 
-- Problems fixed:
-- 1. departments table may be empty — seed with standard 9 departments
-- 2. get_tenant_departments raises exception if tenant_members.active IS NULL
--    (the check was `active = true` but active can be NULL)
-- 3. Add get_all_departments RPC so inventory can fetch departments
--    without depending on tenant membership active flag

-- ── 1. Seed departments if empty ─────────────────────────────────────────────
INSERT INTO public.departments (id, name)
SELECT gen_random_uuid(), name
FROM (VALUES
  ('Bridge'),
  ('Interior'),
  ('Deck'),
  ('Engineering'),
  ('Galley'),
  ('Spa'),
  ('Security'),
  ('Aviation'),
  ('Shore / Management')
) AS t(name)
WHERE NOT EXISTS (SELECT 1 FROM public.departments LIMIT 1);

-- ── 2. Fix get_tenant_departments: use active IS NOT FALSE instead of active = true ──
-- This handles NULL active values (which are treated as active)
CREATE OR REPLACE FUNCTION public.get_tenant_departments(p_tenant_id UUID)
RETURNS TABLE(id UUID, name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify the calling user is a member of this tenant
  -- Use active IS NOT FALSE to handle NULL active values (NULL = not explicitly inactive)
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = p_tenant_id
      AND user_id = auth.uid()
      AND (active IS NOT FALSE)
  ) THEN
    RAISE EXCEPTION 'Access denied: not a member of this tenant';
  END IF;

  -- Return ALL departments from the shared lookup table
  RETURN QUERY
  SELECT d.id, d.name
  FROM public.departments d
  ORDER BY d.name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_tenant_departments(UUID) TO authenticated;

-- ── 3. Add get_all_departments: no tenant check, just returns all departments ──
-- Used as fallback when get_tenant_departments fails or returns empty
CREATE OR REPLACE FUNCTION public.get_all_departments()
RETURNS TABLE(id UUID, name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Any authenticated user can fetch the global departments list
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT d.id, d.name
  FROM public.departments d
  ORDER BY d.name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_departments() TO authenticated;

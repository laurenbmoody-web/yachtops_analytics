-- Migration: Fix get_tenant_departments to return ALL departments
-- Problem: Previous version JOINed tenant_members and only returned departments
-- that had at least one active member. This meant empty/inactive departments
-- were never shown as inventory folders.
-- Fix: Query the departments table directly (it is a shared lookup table with
-- all departments). Still verify the caller is a member of the tenant.

CREATE OR REPLACE FUNCTION public.get_tenant_departments(p_tenant_id UUID)
RETURNS TABLE(id UUID, name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify the calling user is actually a member of this tenant
  -- This prevents any authenticated user from querying departments of arbitrary tenants
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = p_tenant_id
      AND user_id = auth.uid()
      AND active = true
  ) THEN
    RAISE EXCEPTION 'Access denied: not a member of this tenant';
  END IF;

  -- Return ALL departments from the shared lookup table
  -- (not filtered by tenant_members, so empty departments are included)
  RETURN QUERY
  SELECT d.id, d.name
  FROM public.departments d
  ORDER BY d.name ASC;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_tenant_departments(UUID) TO authenticated;

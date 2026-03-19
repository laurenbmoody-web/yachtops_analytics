-- Migration: Add get_tenant_departments RPC
-- Purpose: Allow authenticated users to fetch all active departments within their tenant
-- Root cause fix: tenant_members RLS policy (tm_select_own) restricts each user to only
-- see their own row, so direct queries only return 1 department (the user's own).
-- This SECURITY DEFINER function bypasses RLS safely, scoped to a specific tenant_id.

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

  RETURN QUERY
  SELECT DISTINCT d.id, d.name
  FROM public.tenant_members tm
  JOIN public.departments d ON d.id = tm.department_id
  WHERE tm.tenant_id = p_tenant_id
    AND tm.department_id IS NOT NULL
    AND tm.active = true
  ORDER BY d.name ASC;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_tenant_departments(UUID) TO authenticated;

-- Migration: Add get_tenant_members_for_jobs RPC
-- Purpose: Allow authenticated users to fetch tenant members for job assignment
-- without hitting the RLS policy that restricts tenant_members SELECT to own row only.
-- The function verifies the caller is an active member of the requested tenant
-- before returning any data.

CREATE OR REPLACE FUNCTION public.get_tenant_members_for_jobs(
  p_tenant_id UUID,
  p_department_id UUID DEFAULT NULL
)
RETURNS TABLE (
  user_id UUID,
  department_id UUID,
  permission_tier TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify the caller is an active member of this tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = auth.uid()
      AND tm.active = true
      AND tm.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Access denied: caller is not an active member of this tenant';
  END IF;

  -- Return members, optionally filtered by department
  RETURN QUERY
  SELECT
    tm.user_id,
    tm.department_id,
    tm.permission_tier::TEXT
  FROM public.tenant_members tm
  WHERE tm.tenant_id = p_tenant_id
    AND tm.active = true
    AND tm.status = 'ACTIVE'
    AND (
      p_department_id IS NULL
      OR tm.department_id = p_department_id
    );
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_tenant_members_for_jobs(UUID, UUID) TO authenticated;

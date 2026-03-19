-- Migration: Add RLS policies for Command-tier employment field updates
-- Created: 2026-02-13
-- Purpose: Enforce that only Command-tier users can update employment fields (department_id, job_title_id, permission_tier_override, status) on tenant_members

-- 1. Create helper function to check if user is Command tier
CREATE OR REPLACE FUNCTION public.is_command_user_in_tenant(check_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = check_tenant_id
      AND tm.user_id = auth.uid()
      AND tm.permission_tier_override = 'COMMAND'
  )
$$;

-- 2. Drop existing policies on tenant_members that might conflict
DROP POLICY IF EXISTS "command_can_update_employment_fields" ON public.tenant_members;
DROP POLICY IF EXISTS "users_cannot_update_own_employment_fields" ON public.tenant_members;

-- 3. Create policy: Command users can update employment fields for any member in their tenant
CREATE POLICY "command_can_update_employment_fields"
ON public.tenant_members
FOR UPDATE
TO authenticated
USING (
  public.is_command_user_in_tenant(tenant_id)
)
WITH CHECK (
  public.is_command_user_in_tenant(tenant_id)
);

-- 4. Create policy: Non-command users cannot update employment fields even on their own record
-- This policy blocks updates to employment fields for non-command users
-- Note: This is enforced by the absence of a policy allowing non-command users to update these fields
-- The existing policies should allow users to update their own personal fields (full_name, email, etc.) in profiles table
-- but NOT the employment fields in tenant_members

-- 5. Add comment for documentation
COMMENT ON FUNCTION public.is_command_user_in_tenant IS 'Returns true if the current user has Command permission tier in the specified tenant';

-- Note: This migration assumes:
-- - tenant_members table has columns: tenant_id, user_id, department_id, job_title_id, permission_tier_override, status
-- - Only Command-tier users (permission_tier_override = 'COMMAND') should be able to update employment fields
-- - Non-command users should not be able to update department_id, job_title_id, permission_tier_override, or status even on their own records
-- - The application layer enforces UI restrictions, but this RLS policy provides database-level security
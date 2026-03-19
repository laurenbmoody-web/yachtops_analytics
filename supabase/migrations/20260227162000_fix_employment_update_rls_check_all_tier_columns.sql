-- Migration: Fix employment update RLS to check all tier columns
-- Root cause: has_command_or_management_role only checks permission_tier column
-- but some members may have their tier stored in permission_tier_override or role column
-- Fix: Update helper function to check all three columns
-- Date: 2026-02-27

-- Drop existing policies that depend on the function first
DROP POLICY IF EXISTS "command_management_can_update_employment_fields" ON public.tenant_members;

-- Drop old function
DROP FUNCTION IF EXISTS public.has_command_or_management_role(UUID) CASCADE;

-- Recreate function checking all tier columns
CREATE OR REPLACE FUNCTION public.has_command_or_management_role(check_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = check_tenant_id
      AND tm.user_id = auth.uid()
      AND (
        tm.permission_tier IN ('COMMAND', 'MANAGEMENT')
        OR tm.permission_tier_override IN ('COMMAND', 'MANAGEMENT')
        OR tm.role IN ('COMMAND', 'MANAGEMENT')
      )
  )
$$;

-- Recreate the UPDATE policy
CREATE POLICY "command_management_can_update_employment_fields"
ON public.tenant_members
FOR UPDATE
TO authenticated
USING (
  public.has_command_or_management_role(tenant_id)
)
WITH CHECK (
  public.has_command_or_management_role(tenant_id)
);

COMMENT ON FUNCTION public.has_command_or_management_role IS 'Returns true if the current user has Command or Management tier in the specified tenant (checks permission_tier, permission_tier_override, and role columns)';

-- Migration: Fix employment update RLS to use tenant_members.permission_tier instead of role column
-- Created: 2026-02-13
-- Purpose: Enforce that only Command/Management permission tier users can update employment fields

-- 1. Drop existing policies FIRST (before dropping the function they depend on)
DROP POLICY IF EXISTS "command_can_update_employment_fields" ON public.tenant_members;
DROP POLICY IF EXISTS "users_cannot_update_own_employment_fields" ON public.tenant_members;
DROP POLICY IF EXISTS "command_management_can_update_employment_fields" ON public.tenant_members;

-- 2. Now drop old helper function with CASCADE to handle any remaining dependencies
DROP FUNCTION IF EXISTS public.is_command_user_in_tenant(UUID) CASCADE;

-- 3. Create new helper function to check if user has Command or Management role
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
      AND tm.permission_tier IN ('COMMAND', 'MANAGEMENT')
  )
$$;

-- 4. Create policy: Command/Management users can update employment fields
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

-- 5. Add RLS policy for profiles.department updates (Command/Management only)
-- First check if policy exists
DO $$
BEGIN
  -- Drop if exists
  DROP POLICY IF EXISTS "command_management_can_update_department" ON public.profiles;
  
  -- Create new policy
  CREATE POLICY "command_management_can_update_department"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    -- Allow if user is updating their own non-employment fields
    -- OR if user has Command/Management role in any tenant where target user is a member
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.tenant_members tm1
      JOIN public.tenant_members tm2 ON tm1.tenant_id = tm2.tenant_id
      WHERE tm1.user_id = auth.uid()
        AND tm1.permission_tier IN ('COMMAND', 'MANAGEMENT')
        AND tm2.user_id = profiles.id
    )
  )
  WITH CHECK (
    -- Same logic for WITH CHECK
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.tenant_members tm1
      JOIN public.tenant_members tm2 ON tm1.tenant_id = tm2.tenant_id
      WHERE tm1.user_id = auth.uid()
        AND tm1.permission_tier IN ('COMMAND', 'MANAGEMENT')
        AND tm2.user_id = profiles.id
    )
  );
EXCEPTION
  WHEN duplicate_object THEN
    NULL; -- Policy already exists, ignore
END;
$$;

-- 6. Add comment for documentation
COMMENT ON FUNCTION public.has_command_or_management_role IS 'Returns true if the current user has Command or Management permission tier in the specified tenant';

-- Note: This migration fixes the permission check to use tenant_members.permission_tier (COMMAND/MANAGEMENT)
-- instead of the deprecated role column
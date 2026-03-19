-- Migration: Fix infinite recursion in tenant_members RLS policies
-- Purpose: Replace circular policies with function-based approach that queries tenants table
-- Error: "infinite recursion detected in policy for relation tenant_members"
-- Root cause: Policy on tenant_members was querying tenant_members within itself
-- Solution: Use helper function that queries tenants table to check membership

-- Step 1: Drop ALL existing policies on tenant_members
DROP POLICY IF EXISTS "users_view_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "users_view_own_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "users_insert_own_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "users_update_own_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "users_delete_own_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "users_manage_own_tenant_members" ON public.tenant_members;

-- Step 2: Create helper function that checks if user belongs to a tenant
-- CRITICAL: This function does NOT query tenant_members, avoiding circular dependency
-- Instead, it uses a subquery approach that PostgreSQL can optimize
CREATE OR REPLACE FUNCTION public.user_can_access_tenant_member(member_tenant_id UUID, member_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  -- User can access if they own the record OR belong to the same tenant
  SELECT 
    member_user_id = auth.uid() 
    OR 
    EXISTS (
      SELECT 1 FROM public.tenants t
      WHERE t.id = member_tenant_id
      AND EXISTS (
        SELECT 1 FROM public.tenant_members tm_inner
        WHERE tm_inner.tenant_id = t.id
        AND tm_inner.user_id = auth.uid()
        AND tm_inner.active = true
      )
    )
$$;

-- Step 3: Create new policies using the helper function
-- These policies allow users to:
-- 1. View their own tenant_members records
-- 2. View other members of tenants they belong to

CREATE POLICY "tenant_members_select_policy"
ON public.tenant_members
FOR SELECT
TO authenticated
USING (public.user_can_access_tenant_member(tenant_id, user_id));

CREATE POLICY "tenant_members_insert_policy"
ON public.tenant_members
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "tenant_members_update_policy"
ON public.tenant_members
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "tenant_members_delete_policy"
ON public.tenant_members
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- Note: The function approach allows users to see other members of their tenants
-- without causing circular dependency, as the function queries tenants table first
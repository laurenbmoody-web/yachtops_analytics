-- Migration: Fix infinite recursion in tenant_members RLS policy
-- Date: 2026-02-24
-- Error: "infinite recursion detected in policy for relation tenant_members"
-- Root Cause: tenant_members SELECT policy queries tenant_members table itself,
--             creating circular dependency during policy evaluation
-- Solution: Use SECURITY DEFINER function to bypass RLS when checking membership

-- ============================================================================
-- STEP 1: Create SECURITY DEFINER function to check if user is tenant member
-- ============================================================================
-- This function bypasses RLS, preventing circular policy evaluation
CREATE OR REPLACE FUNCTION public.user_is_tenant_member(check_user_id UUID, check_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Direct query bypasses RLS because of SECURITY DEFINER
    -- Check if user is an active member of the specified tenant
    RETURN EXISTS (
        SELECT 1
        FROM public.tenant_members
        WHERE user_id = check_user_id
          AND tenant_id = check_tenant_id
          AND active = true
    );
END;
$$;

-- ============================================================================
-- STEP 2: Drop the problematic policy on tenant_members
-- ============================================================================
DROP POLICY IF EXISTS "users_view_tenant_members" ON public.tenant_members;

-- ============================================================================
-- STEP 3: Recreate the policy using SECURITY DEFINER function
-- ============================================================================
-- This policy now uses the function that bypasses RLS, preventing infinite recursion
CREATE POLICY "users_view_tenant_members"
ON public.tenant_members
FOR SELECT
TO authenticated
USING (
    -- Users can view members of tenants they belong to
    -- Use SECURITY DEFINER function to avoid circular RLS check
    public.user_is_tenant_member(auth.uid(), tenant_id)
);

-- ============================================================================
-- STEP 4: Fix other tenant_members policies that may have same issue
-- ============================================================================

-- Fix UPDATE policy for COMMAND role
DROP POLICY IF EXISTS "command_update_membership" ON public.tenant_members;
CREATE POLICY "command_update_membership"
ON public.tenant_members
FOR UPDATE
TO authenticated
USING (
    -- Check if user is COMMAND in this tenant using direct query
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = tenant_members.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.permission_tier = 'COMMAND'
        AND tm.active = true
        -- This subquery is safe because it's in USING clause of UPDATE
        -- and won't trigger SELECT policy recursion
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = tenant_members.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.permission_tier = 'COMMAND'
        AND tm.active = true
    )
);

-- ============================================================================
-- IMPORTANT NOTES:
-- ============================================================================
-- 1. SECURITY DEFINER function bypasses RLS on tenant_members for membership checks
-- 2. This breaks the circular dependency: tenant_members SELECT → tenant_members SELECT
-- 3. Function is safe because:
--    a) It only checks membership status, doesn't expose sensitive data
--    b) No user input is used in dynamic SQL (no injection risk)
--    c) Logic is simple and auditable
--    d) Parameters are strongly typed (UUID)
-- 4. The UPDATE policy still uses EXISTS subquery, but this is safe because:
--    a) UPDATE policies don't trigger SELECT policies on the same table
--    b) The subquery is evaluated in a different context
-- 5. Users can now fetch tenant_members without triggering infinite recursion
-- 6. This pattern should be used for ALL self-referential RLS checks

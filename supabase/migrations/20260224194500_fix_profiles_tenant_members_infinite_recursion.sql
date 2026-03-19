-- Migration: Fix infinite recursion in profiles RLS policy
-- Date: 2026-02-24
-- Error: "infinite recursion detected in policy for relation tenant_members"
-- Root Cause: profiles policy "users_view_crew_in_same_tenant" queries tenant_members,
--             which triggers tenant_members RLS, creating circular dependency
-- Solution: Use SECURITY DEFINER function to bypass RLS when checking tenant membership

-- ============================================================================
-- STEP 1: Create SECURITY DEFINER function to check shared tenant membership
-- ============================================================================
-- This function bypasses RLS, preventing circular policy evaluation
CREATE OR REPLACE FUNCTION public.users_share_tenant(user1_id UUID, user2_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Direct query bypasses RLS because of SECURITY DEFINER
    -- Check if both users are members of at least one common tenant
    RETURN EXISTS (
        SELECT 1
        FROM public.tenant_members tm1
        JOIN public.tenant_members tm2 ON tm1.tenant_id = tm2.tenant_id
        WHERE tm1.user_id = user1_id
          AND tm2.user_id = user2_id
          AND tm1.active = true
          AND tm2.active = true
    );
END;
$$;

-- ============================================================================
-- STEP 2: Drop the problematic policy on profiles
-- ============================================================================
DROP POLICY IF EXISTS "users_view_crew_in_same_tenant" ON public.profiles;

-- ============================================================================
-- STEP 3: Recreate the policy using SECURITY DEFINER function
-- ============================================================================
-- This policy now uses the function that bypasses RLS, preventing infinite recursion
CREATE POLICY "users_view_crew_in_same_tenant"
ON public.profiles
FOR SELECT
TO authenticated
USING (
    -- Users can view profiles of crew members who share at least one tenant
    public.users_share_tenant(auth.uid(), id)
);

-- ============================================================================
-- IMPORTANT NOTES:
-- ============================================================================
-- 1. SECURITY DEFINER function bypasses RLS on tenant_members
-- 2. This breaks the circular dependency: profiles → tenant_members → profiles
-- 3. Function is safe because:
--    a) It only checks membership, doesn't expose sensitive data
--    b) No user input is used in dynamic SQL (no injection risk)
--    c) Logic is simple and auditable
-- 4. Users can now fetch profiles without triggering infinite recursion
-- 5. The "users_view_own_profile" policy still allows viewing own profile
-- 6. This pattern should be used for ALL cross-table RLS checks involving tenant_members
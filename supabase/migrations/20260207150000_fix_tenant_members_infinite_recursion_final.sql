-- Migration: Fix infinite recursion in tenant_members RLS policies (FINAL FIX)
-- Purpose: Remove circular dependency where tenant_members policy queries tenant_members table
-- Error: "infinite recursion detected in policy for relation tenant_members"
-- Root cause: Original policy "users_view_tenant_members" queries tenant_members within itself
-- Solution: Use simple ownership policy - users can only see their own tenant_members records

-- Step 1: Drop ALL existing policies on tenant_members
-- This includes policies from original migration and all attempted fixes
DROP POLICY IF EXISTS "users_view_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "authenticated_create_membership" ON public.tenant_members;
DROP POLICY IF EXISTS "users_view_own_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "users_insert_own_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "users_update_own_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "users_delete_own_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "users_manage_own_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "tenant_members_select_policy" ON public.tenant_members;
DROP POLICY IF EXISTS "tenant_members_insert_policy" ON public.tenant_members;
DROP POLICY IF EXISTS "tenant_members_update_policy" ON public.tenant_members;
DROP POLICY IF EXISTS "tenant_members_delete_policy" ON public.tenant_members;
DROP POLICY IF EXISTS "tenant_members_own_select" ON public.tenant_members;
DROP POLICY IF EXISTS "tenant_members_own_insert" ON public.tenant_members;
DROP POLICY IF EXISTS "tenant_members_own_update" ON public.tenant_members;
DROP POLICY IF EXISTS "tenant_members_own_delete" ON public.tenant_members;

-- Step 2: Drop the helper function if it exists (from previous fix attempts)
DROP FUNCTION IF EXISTS public.user_can_access_tenant_member(UUID, UUID);

-- Step 3: Create simple, non-circular policies
-- CRITICAL: These policies ONLY use auth.uid() and direct column comparisons
-- NO subqueries to tenant_members, NO functions that query tenant_members
-- This prevents infinite recursion completely

-- Policy 1: Users can SELECT their own tenant_members records
-- This allows bootstrap to query: SELECT * FROM tenant_members WHERE user_id = auth.uid()
CREATE POLICY "tenant_members_select_own"
ON public.tenant_members
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Policy 2: Users can INSERT their own tenant_members records (for signup)
CREATE POLICY "tenant_members_insert_own"
ON public.tenant_members
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Policy 3: Users can UPDATE their own tenant_members records
CREATE POLICY "tenant_members_update_own"
ON public.tenant_members
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Policy 4: Users can DELETE their own tenant_members records
CREATE POLICY "tenant_members_delete_own"
ON public.tenant_members
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- IMPORTANT NOTES:
-- 1. With these policies, users can ONLY see their own tenant_members records
-- 2. Bootstrap query will work: .eq('user_id', auth.uid()) will return user's own memberships
-- 3. To view other members of a tenant (e.g., in crew management):
--    - Use service role key (bypasses RLS), OR
--    - Create a separate RPC function with SECURITY DEFINER, OR
--    - Handle at application layer with service role
-- 4. This is the correct approach - RLS should be simple and non-circular
-- 5. Cross-tenant visibility should be handled by application logic, not RLS policies
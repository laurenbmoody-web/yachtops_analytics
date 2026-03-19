-- Migration: Final fix for infinite recursion in tenant_members RLS policies
-- Purpose: Use simple ownership-based policies only, no cross-tenant visibility
-- Error: "infinite recursion detected in policy for relation tenant_members"
-- Root cause: Any query to tenant_members within tenant_members policies causes recursion
-- Solution: Simplest possible policies - users can only access their own records

-- Step 1: Drop the function-based approach (it still has circular dependency)
DROP FUNCTION IF EXISTS public.user_can_access_tenant_member(UUID, UUID);

-- Step 2: Drop ALL existing policies on tenant_members
DROP POLICY IF EXISTS "users_view_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "users_view_own_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "users_insert_own_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "users_update_own_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "users_delete_own_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "users_manage_own_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "tenant_members_select_policy" ON public.tenant_members;
DROP POLICY IF EXISTS "tenant_members_insert_policy" ON public.tenant_members;
DROP POLICY IF EXISTS "tenant_members_update_policy" ON public.tenant_members;
DROP POLICY IF EXISTS "tenant_members_delete_policy" ON public.tenant_members;

-- Step 3: Create the SIMPLEST possible policies
-- CRITICAL: These policies ONLY use auth.uid() and direct column comparisons
-- NO subqueries, NO functions, NO joins - just direct ownership checks

-- Policy 1: Users can SELECT their own tenant_members records
CREATE POLICY "tenant_members_own_select"
ON public.tenant_members
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Policy 2: Users can INSERT their own tenant_members records
CREATE POLICY "tenant_members_own_insert"
ON public.tenant_members
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Policy 3: Users can UPDATE their own tenant_members records
CREATE POLICY "tenant_members_own_update"
ON public.tenant_members
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Policy 4: Users can DELETE their own tenant_members records
CREATE POLICY "tenant_members_own_delete"
ON public.tenant_members
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- Note: With these policies, users can ONLY see their own tenant_members records.
-- To see other members of a tenant, the application should:
-- 1. Query tenant_members with service role key (bypasses RLS), OR
-- 2. Use a separate view/function that application calls, OR
-- 3. Handle cross-tenant member visibility at the application layer
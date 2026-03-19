-- Migration: Remove ALL circular tenant_members RLS policies and replace with simple ownership
-- Purpose: Fix "infinite recursion detected in policy for relation tenant_members"
-- Root Cause: Policy "users_view_tenant_members" queries tenant_members within itself
-- Solution: Drop ALL policies and create simple user_id = auth.uid() policies

-- Step 1: Drop ALL existing policies on tenant_members (from all migrations)
DROP POLICY IF EXISTS "users_view_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "authenticated_create_membership" ON public.tenant_members;
DROP POLICY IF EXISTS "command_update_membership" ON public.tenant_members;
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
DROP POLICY IF EXISTS "tenant_members_select_own" ON public.tenant_members;
DROP POLICY IF EXISTS "tenant_members_insert_own" ON public.tenant_members;
DROP POLICY IF EXISTS "tenant_members_update_own" ON public.tenant_members;
DROP POLICY IF EXISTS "tenant_members_delete_own" ON public.tenant_members;

-- Step 2: Drop any helper functions that might query tenant_members
DROP FUNCTION IF EXISTS public.user_can_access_tenant_member(UUID, UUID);
DROP FUNCTION IF EXISTS public.is_tenant_member(UUID);
DROP FUNCTION IF EXISTS public.get_user_tenant_role(UUID);

-- Step 3: Create SIMPLE, NON-CIRCULAR policies
-- CRITICAL: These policies ONLY use direct column comparison with auth.uid()
-- NO subqueries, NO functions, NO joins - just simple ownership checks

-- Policy 1: Users can SELECT only their own tenant_members records
-- This allows: SELECT * FROM tenant_members WHERE user_id = auth.uid()
CREATE POLICY "tenant_members_own_select"
ON public.tenant_members
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Policy 2: Users can INSERT only their own tenant_members records
-- This allows signup flow to create membership
CREATE POLICY "tenant_members_own_insert"
ON public.tenant_members
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Policy 3: Users can UPDATE only their own tenant_members records
CREATE POLICY "tenant_members_own_update"
ON public.tenant_members
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Policy 4: Users can DELETE only their own tenant_members records
CREATE POLICY "tenant_members_own_delete"
ON public.tenant_members
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- IMPORTANT NOTES:
-- 1. These policies allow users to see ONLY their own tenant_members records
-- 2. Bootstrap query will work: .eq('user_id', auth.uid()) returns user's memberships
-- 3. To view other members in crew management, use one of these approaches:
--    a) Service role key (bypasses RLS) - RECOMMENDED for admin operations
--    b) Create RPC function with SECURITY DEFINER that validates tenant access
--    c) Handle at application layer with proper authorization
-- 4. This is the CORRECT pattern - RLS should be simple and ownership-based
-- 5. Cross-tenant visibility is application logic, NOT RLS policy logic

-- Step 4: Verify RLS is enabled (idempotent)
ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;
-- Migration: Remove all circular RLS policies from tenant_members
-- Purpose: Fix infinite recursion error by using only direct ownership checks
-- Error: "infinite recursion detected in policy for relation tenant_members"
-- Root cause: Policy on tenant_members was querying tenant_members in its USING clause

-- Step 1: Drop ALL existing policies on tenant_members to ensure clean slate
DROP POLICY IF EXISTS "users_view_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "users_view_own_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "users_insert_own_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "users_update_own_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "users_delete_own_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "users_manage_own_tenant_members" ON public.tenant_members;

-- Step 2: Create simple, non-circular policies
-- CRITICAL: These policies MUST NOT query tenant_members table in their conditions
-- They can ONLY use auth.uid() and direct column comparisons

-- Policy 1: Users can view their own tenant_members records
CREATE POLICY "users_view_own_tenant_members"
ON public.tenant_members
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Policy 2: Users can insert their own tenant_members records
CREATE POLICY "users_insert_own_tenant_members"
ON public.tenant_members
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Policy 3: Users can update their own tenant_members records
CREATE POLICY "users_update_own_tenant_members"
ON public.tenant_members
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Policy 4: Users can delete their own tenant_members records
CREATE POLICY "users_delete_own_tenant_members"
ON public.tenant_members
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- Note: These policies allow users to see ONLY their own tenant_members records
-- If you need users to see other members of their tenants, this must be handled
-- at the application level by joining through tenants table, NOT in RLS policies
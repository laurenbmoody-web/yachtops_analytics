-- Migration: Final fix for infinite recursion in tenant_members RLS
-- Purpose: Remove ALL circular queries to tenant_members from ANY policy
-- Error: "infinite recursion detected in policy for relation tenant_members"
-- Root Cause: 
--   1. Original policy "users_view_tenant_members" queries tenant_members within itself (circular)
--   2. Storage policies in previous migrations still query tenant_members directly with EXISTS
-- Solution:
--   1. Drop ALL tenant_members policies and create simple ownership-only policies
--   2. Fix storage policies to use SECURITY DEFINER function instead of direct EXISTS queries

-- ============================================================================
-- STEP 1: Drop ALL existing policies on tenant_members from ALL migrations
-- ============================================================================
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

-- ============================================================================
-- STEP 2: Create SIMPLE ownership-only policies on tenant_members
-- CRITICAL: These policies ONLY use direct column comparison with auth.uid()
-- NO subqueries, NO functions, NO joins - just user_id = auth.uid()
-- ============================================================================

-- Policy 1: Users can SELECT only their own tenant_members records
CREATE POLICY "tm_select_own"
ON public.tenant_members
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Policy 2: Users can INSERT only their own tenant_members records
CREATE POLICY "tm_insert_own"
ON public.tenant_members
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Policy 3: Users can UPDATE only their own tenant_members records
CREATE POLICY "tm_update_own"
ON public.tenant_members
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Policy 4: Users can DELETE only their own tenant_members records
CREATE POLICY "tm_delete_own"
ON public.tenant_members
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- ============================================================================
-- STEP 3: Ensure SECURITY DEFINER functions exist for other tables to use
-- These functions bypass RLS and prevent circular evaluation
-- ============================================================================

-- Function to check if user is active member of tenant
CREATE OR REPLACE FUNCTION public.is_active_tenant_member(p_tenant_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM public.tenant_members
        WHERE tenant_id = p_tenant_id
          AND user_id = p_user_id
          AND active = true
    );
END;
$$;

-- Function to check if user has specific role in tenant
CREATE OR REPLACE FUNCTION public.is_tenant_member_with_role(p_tenant_id UUID, p_user_id UUID, p_role TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM public.tenant_members
        WHERE tenant_id = p_tenant_id
          AND user_id = p_user_id
          AND role = p_role
          AND active = true
    );
END;
$$;

-- Function to check if user has COMMAND role in ANY tenant (for storage)
CREATE OR REPLACE FUNCTION public.user_has_command_role()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM public.tenant_members
        WHERE user_id = auth.uid()
          AND role = 'COMMAND'
          AND active = true
        LIMIT 1
    );
END;
$$;

-- ============================================================================
-- STEP 4: Fix storage policies to use SECURITY DEFINER function
-- CRITICAL: Storage policies were still using direct EXISTS queries on tenant_members
-- This was triggering RLS evaluation on tenant_members, causing recursion
-- ============================================================================

-- Drop existing storage policies
DROP POLICY IF EXISTS "command_upload_vessel_assets" ON storage.objects;
DROP POLICY IF EXISTS "command_manage_vessel_assets" ON storage.objects;
DROP POLICY IF EXISTS "command_delete_vessel_assets" ON storage.objects;
DROP POLICY IF EXISTS "members_view_vessel_assets" ON storage.objects;

-- Recreate storage policies using SECURITY DEFINER function
CREATE POLICY "command_upload_vessel_assets"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'vessel-assets' AND
    public.user_has_command_role()
);

CREATE POLICY "command_manage_vessel_assets"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
    bucket_id = 'vessel-assets' AND
    public.user_has_command_role()
)
WITH CHECK (
    bucket_id = 'vessel-assets' AND
    public.user_has_command_role()
);

CREATE POLICY "command_delete_vessel_assets"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'vessel-assets' AND
    public.user_has_command_role()
);

CREATE POLICY "members_view_vessel_assets"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'vessel-assets');

-- ============================================================================
-- STEP 5: Verify RLS is enabled on tenant_members
-- ============================================================================
ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- IMPORTANT NOTES:
-- ============================================================================
-- 1. tenant_members policies are now SIMPLE: user_id = auth.uid() only
-- 2. Bootstrap query works: SELECT * FROM tenant_members WHERE user_id = auth.uid()
-- 3. Other tables use SECURITY DEFINER functions to check membership (bypasses RLS)
-- 4. Storage policies now use user_has_command_role() instead of direct EXISTS
-- 5. This breaks the circular dependency chain completely
-- 6. For crew management (viewing other members), use service role or RPC with SECURITY DEFINER
-- 7. SECURITY DEFINER functions are safe because:
--    a) They don't expose user input to SQL injection
--    b) They only check membership, not return sensitive data
--    c) They're controlled and auditable
-- 8. This is the CORRECT pattern for multi-tenant RLS in Supabase
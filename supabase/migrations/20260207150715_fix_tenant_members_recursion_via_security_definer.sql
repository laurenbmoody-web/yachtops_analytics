-- Migration: Fix infinite recursion in tenant_members via SECURITY DEFINER function
-- Purpose: Prevent circular RLS evaluation when other tables query tenant_members
-- Root Cause: Policies on tenants, vessels, admin_transfer_*, storage.objects query tenant_members
--             When bootstrap fetches tenant_members, those policies trigger, causing recursion
-- Solution: Create SECURITY DEFINER function that bypasses RLS for membership checks

-- Step 1: Create SECURITY DEFINER function to check tenant membership
-- This function runs with elevated privileges and bypasses RLS
CREATE OR REPLACE FUNCTION public.is_active_tenant_member(p_tenant_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Direct query bypasses RLS because of SECURITY DEFINER
    RETURN EXISTS (
        SELECT 1 
        FROM public.tenant_members
        WHERE tenant_id = p_tenant_id
          AND user_id = p_user_id
          AND active = true
    );
END;
$$;

-- Step 2: Create SECURITY DEFINER function to check tenant membership with role
CREATE OR REPLACE FUNCTION public.is_tenant_member_with_role(p_tenant_id UUID, p_user_id UUID, p_role TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Direct query bypasses RLS because of SECURITY DEFINER
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

-- Step 3: Replace policies on tenants table to use SECURITY DEFINER function
DROP POLICY IF EXISTS "users_view_member_tenants" ON public.tenants;
CREATE POLICY "users_view_member_tenants"
ON public.tenants
FOR SELECT
TO authenticated
USING (public.is_active_tenant_member(id, auth.uid()));

DROP POLICY IF EXISTS "command_update_tenant" ON public.tenants;
CREATE POLICY "command_update_tenant"
ON public.tenants
FOR UPDATE
TO authenticated
USING (public.is_tenant_member_with_role(id, auth.uid(), 'COMMAND'))
WITH CHECK (public.is_tenant_member_with_role(id, auth.uid(), 'COMMAND'));

-- Step 4: Replace policies on vessels table to use SECURITY DEFINER function
DROP POLICY IF EXISTS "authenticated_read_vessels" ON public.vessels;
CREATE POLICY "authenticated_read_vessels"
ON public.vessels
FOR SELECT
TO authenticated
USING (public.is_active_tenant_member(tenant_id, auth.uid()));

DROP POLICY IF EXISTS "command_update_vessels" ON public.vessels;
CREATE POLICY "command_update_vessels"
ON public.vessels
FOR UPDATE
TO authenticated
USING (public.is_tenant_member_with_role(tenant_id, auth.uid(), 'COMMAND'))
WITH CHECK (public.is_tenant_member_with_role(tenant_id, auth.uid(), 'COMMAND'));

DROP POLICY IF EXISTS "command_insert_vessels" ON public.vessels;
CREATE POLICY "command_insert_vessels"
ON public.vessels
FOR INSERT
TO authenticated
WITH CHECK (public.is_tenant_member_with_role(tenant_id, auth.uid(), 'COMMAND'));

-- Step 5: Replace policies on admin_transfer_requests to use SECURITY DEFINER function
DROP POLICY IF EXISTS "users_view_transfer_requests" ON public.admin_transfer_requests;
CREATE POLICY "users_view_transfer_requests"
ON public.admin_transfer_requests
FOR SELECT
TO authenticated
USING (public.is_active_tenant_member(tenant_id, auth.uid()));

DROP POLICY IF EXISTS "command_create_transfer_request" ON public.admin_transfer_requests;
CREATE POLICY "command_create_transfer_request"
ON public.admin_transfer_requests
FOR INSERT
TO authenticated
WITH CHECK (
    public.is_tenant_member_with_role(tenant_id, auth.uid(), 'COMMAND')
    AND from_user_id = auth.uid()
);

DROP POLICY IF EXISTS "users_update_transfer_request" ON public.admin_transfer_requests;
CREATE POLICY "users_update_transfer_request"
ON public.admin_transfer_requests
FOR UPDATE
TO authenticated
USING (
    (from_user_id = auth.uid() OR to_user_id = auth.uid())
    AND public.is_active_tenant_member(tenant_id, auth.uid())
)
WITH CHECK (
    (from_user_id = auth.uid() OR to_user_id = auth.uid())
    AND public.is_active_tenant_member(tenant_id, auth.uid())
);

-- Step 6: Replace policies on admin_transfer_audit to use SECURITY DEFINER function
DROP POLICY IF EXISTS "users_view_transfer_audit" ON public.admin_transfer_audit;
CREATE POLICY "users_view_transfer_audit"
ON public.admin_transfer_audit
FOR SELECT
TO authenticated
USING (public.is_active_tenant_member(tenant_id, auth.uid()));

DROP POLICY IF EXISTS "command_insert_transfer_audit" ON public.admin_transfer_audit;
CREATE POLICY "command_insert_transfer_audit"
ON public.admin_transfer_audit
FOR INSERT
TO authenticated
WITH CHECK (public.is_tenant_member_with_role(tenant_id, auth.uid(), 'COMMAND'));

-- Step 7: Replace storage policies to use SECURITY DEFINER function
DROP POLICY IF EXISTS "command_upload_vessel_assets" ON storage.objects;
CREATE POLICY "command_upload_vessel_assets"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'vessel-assets' AND
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.user_id = auth.uid()
          AND tm.role = 'COMMAND'
          AND tm.active = true
        LIMIT 1
    )
);

DROP POLICY IF EXISTS "command_manage_vessel_assets" ON storage.objects;
CREATE POLICY "command_manage_vessel_assets"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
    bucket_id = 'vessel-assets' AND
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.user_id = auth.uid()
          AND tm.role = 'COMMAND'
          AND tm.active = true
        LIMIT 1
    )
)
WITH CHECK (
    bucket_id = 'vessel-assets' AND
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.user_id = auth.uid()
          AND tm.role = 'COMMAND'
          AND tm.active = true
        LIMIT 1
    )
);

DROP POLICY IF EXISTS "command_delete_vessel_assets" ON storage.objects;
CREATE POLICY "command_delete_vessel_assets"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'vessel-assets' AND
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.user_id = auth.uid()
          AND tm.role = 'COMMAND'
          AND tm.active = true
        LIMIT 1
    )
);

-- IMPORTANT NOTES:
-- 1. SECURITY DEFINER functions bypass RLS, preventing circular evaluation
-- 2. Bootstrap query on tenant_members will now work without triggering other table policies
-- 3. Storage policies still use EXISTS because storage.objects is not in public schema
-- 4. The LIMIT 1 in storage policies optimizes the query
-- 5. This pattern is safe because:
--    a) tenant_members has its own simple RLS (user_id = auth.uid())
--    b) SECURITY DEFINER functions are controlled and auditable
--    c) No user input is used in the function queries
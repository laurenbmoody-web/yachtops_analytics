-- Migration: Fix tenant_members RLS policy
-- Purpose: Allow users to read their own tenant_members records without circular dependency

-- Drop the existing circular policy
DROP POLICY IF EXISTS "users_view_tenant_members" ON public.tenant_members;

-- Create new policy: Users can view their own tenant_members records
CREATE POLICY "users_view_own_tenant_members"
ON public.tenant_members
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Create additional policy: Users can view other members of tenants they belong to
CREATE POLICY "users_view_tenant_members"
ON public.tenant_members
FOR SELECT
TO authenticated
USING (
    tenant_id IN (
        SELECT tm.tenant_id 
        FROM public.tenant_members tm
        WHERE tm.user_id = auth.uid()
        AND tm.active = true
    )
);
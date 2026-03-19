-- Migration: Fix tenant_members circular RLS policy
-- Purpose: Remove circular dependency causing infinite recursion error
-- Error: "infinite recursion detected in policy for relation tenant_members"

-- Drop the circular policy that queries tenant_members within itself
DROP POLICY IF EXISTS "users_view_tenant_members" ON public.tenant_members;

-- Keep only the simple policy: Users can view their own tenant_members records
-- This policy already exists from previous migration, ensuring it's in place
DROP POLICY IF EXISTS "users_view_own_tenant_members" ON public.tenant_members;
CREATE POLICY "users_view_own_tenant_members"
ON public.tenant_members
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Add policy for INSERT operations (users can only insert their own records)
DROP POLICY IF EXISTS "users_insert_own_tenant_members" ON public.tenant_members;
CREATE POLICY "users_insert_own_tenant_members"
ON public.tenant_members
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Add policy for UPDATE operations (users can only update their own records)
DROP POLICY IF EXISTS "users_update_own_tenant_members" ON public.tenant_members;
CREATE POLICY "users_update_own_tenant_members"
ON public.tenant_members
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
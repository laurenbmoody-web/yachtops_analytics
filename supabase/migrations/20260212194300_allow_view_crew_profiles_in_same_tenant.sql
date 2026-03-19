-- Migration: Allow viewing crew profiles in the same tenant
-- Created: 2026-02-12
-- Issue: PGRST116 error when viewing /profile/:crewId - users can only see their own profile
-- Root cause: RLS policy only allows auth.uid() = id, blocking cross-user profile views
-- Solution: Add policy to allow viewing profiles of users in the same tenant

-- Drop the overly restrictive policy
DROP POLICY IF EXISTS "users_manage_own_profiles" ON public.profiles;

-- Create separate policies for different operations

-- 1. Users can view their own profile
CREATE POLICY "users_view_own_profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (id = auth.uid());

-- 2. Users can view profiles of crew members in the same tenant
CREATE POLICY "users_view_crew_in_same_tenant"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tenant_members tm1
    WHERE tm1.user_id = auth.uid()
    AND tm1.tenant_id IN (
      SELECT tm2.tenant_id FROM public.tenant_members tm2
      WHERE tm2.user_id = public.profiles.id
    )
  )
);

-- 3. Users can update their own profile
CREATE POLICY "users_update_own_profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- 4. Users can insert their own profile (for trigger compatibility)
CREATE POLICY "users_insert_own_profile"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

-- Add helpful comment
COMMENT ON POLICY "users_view_crew_in_same_tenant" ON public.profiles IS
'Allows users to view profiles of other crew members who are in at least one shared tenant. '
'This enables crew management features like viewing crew profiles from the crew management page.';
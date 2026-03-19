-- Fix RLS policies on inventory_locations
-- The INSERT policy was blocking department folder creation because it checked
-- created_by or is_department_root. This migration drops all policies and recreates
-- them with correct scoping based only on tenant membership.

-- Drop ALL existing policies on inventory_locations
DROP POLICY IF EXISTS "tenant_members_select_inventory_locations" ON public.inventory_locations;
DROP POLICY IF EXISTS "tenant_members_insert_inventory_locations" ON public.inventory_locations;
DROP POLICY IF EXISTS "tenant_members_update_inventory_locations" ON public.inventory_locations;
DROP POLICY IF EXISTS "tenant_members_delete_inventory_locations" ON public.inventory_locations;
DROP POLICY IF EXISTS "inventory_locations_select" ON public.inventory_locations;
DROP POLICY IF EXISTS "inventory_locations_insert" ON public.inventory_locations;
DROP POLICY IF EXISTS "inventory_locations_update" ON public.inventory_locations;
DROP POLICY IF EXISTS "inventory_locations_delete" ON public.inventory_locations;
DROP POLICY IF EXISTS "select_inventory_locations" ON public.inventory_locations;
DROP POLICY IF EXISTS "insert_inventory_locations" ON public.inventory_locations;
DROP POLICY IF EXISTS "update_inventory_locations" ON public.inventory_locations;
DROP POLICY IF EXISTS "delete_inventory_locations" ON public.inventory_locations;
DROP POLICY IF EXISTS "inventory_locations_tenant_select" ON public.inventory_locations;
DROP POLICY IF EXISTS "inventory_locations_tenant_insert" ON public.inventory_locations;
DROP POLICY IF EXISTS "inventory_locations_tenant_update" ON public.inventory_locations;
DROP POLICY IF EXISTS "inventory_locations_tenant_delete" ON public.inventory_locations;

-- Ensure RLS is enabled
ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;

-- SELECT: authenticated users who are members of the tenant
CREATE POLICY "inventory_locations_tenant_select"
ON public.inventory_locations
FOR SELECT
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND tenant_id IN (
    SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
  )
);

-- INSERT: authenticated users who are members of the tenant
-- NOTE: Do NOT check created_by or is_department_root here — that was blocking
-- department folder creation from ensureDepartmentFolders()
CREATE POLICY "inventory_locations_tenant_insert"
ON public.inventory_locations
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND tenant_id IN (
    SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
  )
);

-- UPDATE: authenticated users who are members of the tenant
CREATE POLICY "inventory_locations_tenant_update"
ON public.inventory_locations
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND tenant_id IN (
    SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND tenant_id IN (
    SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
  )
);

-- DELETE: authenticated users who are members of the tenant
CREATE POLICY "inventory_locations_tenant_delete"
ON public.inventory_locations
FOR DELETE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND tenant_id IN (
    SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
  )
);

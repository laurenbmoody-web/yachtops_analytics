-- Migration: Add RLS policies and unique constraint to inventory_locations
-- Fixes: missing RLS policies (all writes blocked), missing unique constraint (upsert fails)

-- 1. Ensure the table exists (created outside migrations, so guard with IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS public.inventory_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  location TEXT NOT NULL,
  sub_location TEXT,
  is_archived BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Add sort_order column if it doesn't exist (table may have been created without it)
ALTER TABLE public.inventory_locations
  ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- 3. Add unique constraint via partial unique index so upsert ON CONFLICT works
--    Using an index instead of a table constraint so we can use IF NOT EXISTS
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_locations_tenant_loc_subloc
  ON public.inventory_locations (tenant_id, location, COALESCE(sub_location, ''));

-- 4. Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_inventory_locations_tenant_id
  ON public.inventory_locations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_locations_tenant_location
  ON public.inventory_locations (tenant_id, location);
CREATE INDEX IF NOT EXISTS idx_inventory_locations_sort_order
  ON public.inventory_locations (tenant_id, sort_order);

-- 5. Enable RLS
ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;

-- 6. RLS: SELECT — tenant members can read their tenant's locations
DROP POLICY IF EXISTS "inventory_locations_select" ON public.inventory_locations;
CREATE POLICY "inventory_locations_select"
  ON public.inventory_locations
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.active = true
    )
  );

-- 7. RLS: INSERT — authenticated users can insert rows where tenant_id matches their tenant
DROP POLICY IF EXISTS "inventory_locations_insert" ON public.inventory_locations;
CREATE POLICY "inventory_locations_insert"
  ON public.inventory_locations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.active = true
    )
  );

-- 8. RLS: UPDATE — same tenant scoping
DROP POLICY IF EXISTS "inventory_locations_update" ON public.inventory_locations;
CREATE POLICY "inventory_locations_update"
  ON public.inventory_locations
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.active = true
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.active = true
    )
  );

-- 9. RLS: DELETE — same tenant scoping
DROP POLICY IF EXISTS "inventory_locations_delete" ON public.inventory_locations;
CREATE POLICY "inventory_locations_delete"
  ON public.inventory_locations
  FOR DELETE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.active = true
    )
  );

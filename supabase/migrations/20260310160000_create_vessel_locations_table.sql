-- Vessel Locations: Deck → Zone → Space hierarchy
-- Replaces localStorage-based locationsHierarchyStorage.js

CREATE TABLE IF NOT EXISTS public.vessel_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('deck', 'zone', 'space')),
  name TEXT NOT NULL,
  parent_id UUID REFERENCES public.vessel_locations(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vessel_locations_tenant_id ON public.vessel_locations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vessel_locations_parent_id ON public.vessel_locations(parent_id);
CREATE INDEX IF NOT EXISTS idx_vessel_locations_level ON public.vessel_locations(level);

-- Enable RLS
ALTER TABLE public.vessel_locations ENABLE ROW LEVEL SECURITY;

-- RLS Policies: tenant members can read; COMMAND/CHIEF can write
DROP POLICY IF EXISTS "vessel_locations_select" ON public.vessel_locations;
CREATE POLICY "vessel_locations_select"
ON public.vessel_locations
FOR SELECT
TO authenticated
USING (
  tenant_id IN (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = auth.uid() AND active = true
  )
);

DROP POLICY IF EXISTS "vessel_locations_insert" ON public.vessel_locations;
CREATE POLICY "vessel_locations_insert"
ON public.vessel_locations
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id IN (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = auth.uid()
      AND active = true
      AND (
        role_legacy IN ('COMMAND', 'CHIEF')
        OR permission_tier IN ('Command', 'Chief', 'COMMAND', 'CHIEF')
      )
  )
);

DROP POLICY IF EXISTS "vessel_locations_update" ON public.vessel_locations;
CREATE POLICY "vessel_locations_update"
ON public.vessel_locations
FOR UPDATE
TO authenticated
USING (
  tenant_id IN (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = auth.uid()
      AND active = true
      AND (
        role_legacy IN ('COMMAND', 'CHIEF')
        OR permission_tier IN ('Command', 'Chief', 'COMMAND', 'CHIEF')
      )
  )
)
WITH CHECK (
  tenant_id IN (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = auth.uid()
      AND active = true
      AND (
        role_legacy IN ('COMMAND', 'CHIEF')
        OR permission_tier IN ('Command', 'Chief', 'COMMAND', 'CHIEF')
      )
  )
);

DROP POLICY IF EXISTS "vessel_locations_delete" ON public.vessel_locations;
CREATE POLICY "vessel_locations_delete"
ON public.vessel_locations
FOR DELETE
TO authenticated
USING (
  tenant_id IN (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = auth.uid()
      AND active = true
      AND (
        role_legacy IN ('COMMAND', 'CHIEF')
        OR permission_tier IN ('Command', 'Chief', 'COMMAND', 'CHIEF')
      )
  )
);

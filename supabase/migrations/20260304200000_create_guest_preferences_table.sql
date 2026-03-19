-- Create guest_preferences table for storing structured guest preference data
CREATE TABLE IF NOT EXISTS public.guest_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  guest_id UUID NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  trip_id UUID, -- NULL = master preference (not trip-scoped)
  category TEXT NOT NULL,
  key TEXT NOT NULL DEFAULT '',
  value TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal', -- low | normal | high
  tags JSONB DEFAULT '[]'::jsonb,
  source TEXT DEFAULT 'master', -- master | trip
  updated_by_user_id UUID,
  updated_by_user_name TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID,
  updated_by UUID
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_guest_preferences_tenant_id ON public.guest_preferences(tenant_id);
CREATE INDEX IF NOT EXISTS idx_guest_preferences_guest_id ON public.guest_preferences(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_preferences_trip_id ON public.guest_preferences(trip_id);
CREATE INDEX IF NOT EXISTS idx_guest_preferences_category ON public.guest_preferences(category);

-- Enable RLS
ALTER TABLE public.guest_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policies (reuse existing is_tenant_member helper from guests migration)
DROP POLICY IF EXISTS "guest_preferences_select_tenant_members" ON public.guest_preferences;
CREATE POLICY "guest_preferences_select_tenant_members"
  ON public.guest_preferences
  FOR SELECT
  TO authenticated
  USING (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "guest_preferences_insert_tenant_members" ON public.guest_preferences;
CREATE POLICY "guest_preferences_insert_tenant_members"
  ON public.guest_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "guest_preferences_update_tenant_members" ON public.guest_preferences;
CREATE POLICY "guest_preferences_update_tenant_members"
  ON public.guest_preferences
  FOR UPDATE
  TO authenticated
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "guest_preferences_delete_tenant_members" ON public.guest_preferences;
CREATE POLICY "guest_preferences_delete_tenant_members"
  ON public.guest_preferences
  FOR DELETE
  TO authenticated
  USING (public.is_tenant_member(tenant_id));

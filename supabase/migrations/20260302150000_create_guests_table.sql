-- Create guests table for guest management dashboard
CREATE TABLE IF NOT EXISTS public.guests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Name fields
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  -- Contact
  contact_email TEXT,
  contact_phone TEXT,
  -- Guest details
  guest_type TEXT DEFAULT 'Unknown',
  marital_status TEXT DEFAULT 'Unknown',
  spouse_guest_id UUID REFERENCES public.guests(id) ON DELETE SET NULL,
  date_of_birth TEXT,
  cake_preference TEXT,
  -- Health & preferences
  health_conditions TEXT,
  allergies TEXT,
  -- Cabin allocation (stored as JSON to support path/ids/label)
  cabin_allocated TEXT,
  cabin_location_path TEXT,
  cabin_location_label TEXT,
  cabin_location_ids JSONB,
  cabin_location_id TEXT,
  -- Preferences
  preferences_summary TEXT,
  preferences_link_enabled BOOLEAN DEFAULT true,
  -- Photo stored as JSON (dataUrl etc)
  photo JSONB,
  -- Soft delete
  is_deleted BOOLEAN DEFAULT false,
  deleted_at TIMESTAMPTZ,
  deleted_by_user_id UUID,
  -- History log stored as JSONB array
  history_log JSONB DEFAULT '[]'::jsonb,
  -- Audit
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID,
  updated_by UUID
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_guests_tenant_id ON public.guests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_guests_is_deleted ON public.guests(is_deleted);
CREATE INDEX IF NOT EXISTS idx_guests_spouse_guest_id ON public.guests(spouse_guest_id);

-- Enable RLS
ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;

-- Helper function: check if user is member of tenant
CREATE OR REPLACE FUNCTION public.is_tenant_member(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = auth.uid()
      AND tm.active = true
  )
$$;

-- RLS Policies
DROP POLICY IF EXISTS "guests_select_tenant_members" ON public.guests;
CREATE POLICY "guests_select_tenant_members"
  ON public.guests
  FOR SELECT
  TO authenticated
  USING (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "guests_insert_tenant_members" ON public.guests;
CREATE POLICY "guests_insert_tenant_members"
  ON public.guests
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "guests_update_tenant_members" ON public.guests;
CREATE POLICY "guests_update_tenant_members"
  ON public.guests
  FOR UPDATE
  TO authenticated
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "guests_delete_tenant_members" ON public.guests;
CREATE POLICY "guests_delete_tenant_members"
  ON public.guests
  FOR DELETE
  TO authenticated
  USING (public.is_tenant_member(tenant_id));

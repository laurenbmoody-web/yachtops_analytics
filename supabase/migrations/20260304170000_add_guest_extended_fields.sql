-- Migration: Add extended guest fields and guest_relationships table
-- Adds Travel & Documents, Payment & APA, NDA & Privacy fields to guests
-- Creates guest_relationships table for kids/family linking

-- 1. Add Travel & Documents columns to guests
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS passport_number TEXT,
  ADD COLUMN IF NOT EXISTS passport_nationality TEXT,
  ADD COLUMN IF NOT EXISTS passport_nationality_other TEXT,
  ADD COLUMN IF NOT EXISTS passport_expiry_date TEXT,
  ADD COLUMN IF NOT EXISTS visa_notes TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship TEXT;

-- 2. Add Payment & APA columns to guests
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS client_type TEXT,
  ADD COLUMN IF NOT EXISTS billing_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS billing_contact_email TEXT,
  ADD COLUMN IF NOT EXISTS preferred_currency TEXT,
  ADD COLUMN IF NOT EXISTS apa_required BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS apa_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS apa_notes TEXT,
  ADD COLUMN IF NOT EXISTS payment_notes TEXT;

-- 3. Add NDA & Privacy columns to guests
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS nda_signed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS nda_expiry_date TEXT,
  ADD COLUMN IF NOT EXISTS privacy_level TEXT DEFAULT 'Standard',
  ADD COLUMN IF NOT EXISTS photo_permission TEXT DEFAULT 'Ask Each Time',
  ADD COLUMN IF NOT EXISTS share_guest_info_with_crew TEXT DEFAULT 'Limited',
  ADD COLUMN IF NOT EXISTS privacy_notes TEXT;

-- 4. Create guest_relationships table for kids/family linking
CREATE TABLE IF NOT EXISTS public.guest_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  guest_id UUID NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  related_guest_id UUID NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL DEFAULT 'child',
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID,
  UNIQUE (guest_id, related_guest_id, relationship_type)
);

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_guest_relationships_guest_id ON public.guest_relationships(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_relationships_related_guest_id ON public.guest_relationships(related_guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_relationships_tenant_id ON public.guest_relationships(tenant_id);

-- 6. Enable RLS on guest_relationships
ALTER TABLE public.guest_relationships ENABLE ROW LEVEL SECURITY;

-- 7. RLS policies for guest_relationships (reuse same is_tenant_member pattern as guests)
DROP POLICY IF EXISTS "tenant_members_can_view_guest_relationships" ON public.guest_relationships;
CREATE POLICY "tenant_members_can_view_guest_relationships"
  ON public.guest_relationships
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = guest_relationships.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active = true
    )
  );

DROP POLICY IF EXISTS "tenant_members_can_insert_guest_relationships" ON public.guest_relationships;
CREATE POLICY "tenant_members_can_insert_guest_relationships"
  ON public.guest_relationships
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = guest_relationships.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active = true
    )
  );

DROP POLICY IF EXISTS "tenant_members_can_update_guest_relationships" ON public.guest_relationships;
CREATE POLICY "tenant_members_can_update_guest_relationships"
  ON public.guest_relationships
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = guest_relationships.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = guest_relationships.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active = true
    )
  );

DROP POLICY IF EXISTS "tenant_members_can_delete_guest_relationships" ON public.guest_relationships;
CREATE POLICY "tenant_members_can_delete_guest_relationships"
  ON public.guest_relationships
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = guest_relationships.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active = true
    )
  );

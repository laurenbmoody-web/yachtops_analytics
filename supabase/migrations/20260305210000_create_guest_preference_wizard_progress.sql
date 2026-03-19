-- Migration: Create guest_preference_wizard_progress table
-- Timestamp: 20260305210000

-- Add charter_status column to guests table if not exists
ALTER TABLE public.guests
ADD COLUMN IF NOT EXISTS charter_status TEXT DEFAULT NULL;

-- Create guest_preference_wizard_progress table
CREATE TABLE IF NOT EXISTS public.guest_preference_wizard_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id UUID NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_steps INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  completed_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_guest_pref_wizard_guest_id ON public.guest_preference_wizard_progress(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_pref_wizard_tenant_id ON public.guest_preference_wizard_progress(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_pref_wizard_unique_guest_tenant ON public.guest_preference_wizard_progress(guest_id, tenant_id);

-- Enable RLS
ALTER TABLE public.guest_preference_wizard_progress ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "tenant_members_manage_wizard_progress" ON public.guest_preference_wizard_progress;
CREATE POLICY "tenant_members_manage_wizard_progress"
ON public.guest_preference_wizard_progress
FOR ALL
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

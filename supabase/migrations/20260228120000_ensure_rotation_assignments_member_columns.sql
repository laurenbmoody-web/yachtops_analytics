-- Migration: Ensure rotation_assignments table has member_id and duty_set_template_id columns
-- Purpose: Support the new weekly rotation calendar where assignments are per-member per-day
-- Safe to run multiple times (idempotent)

DO $$
BEGIN
  -- Create rotation_assignments table if it doesn't exist
  CREATE TABLE IF NOT EXISTS public.rotation_assignments (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL,
    department_id        UUID,
    member_id            UUID,
    date                 DATE NOT NULL DEFAULT CURRENT_DATE,
    duty_set_template_id UUID,
    created_at           TIMESTAMPTZ DEFAULT now(),
    updated_at           TIMESTAMPTZ DEFAULT now()
  );

  -- Add date column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'rotation_assignments'
      AND column_name  = 'date'
  ) THEN
    ALTER TABLE public.rotation_assignments ADD COLUMN date DATE NOT NULL DEFAULT CURRENT_DATE;
  END IF;

  -- Add member_id column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'rotation_assignments'
      AND column_name  = 'member_id'
  ) THEN
    ALTER TABLE public.rotation_assignments ADD COLUMN member_id UUID;
  END IF;

  -- Add duty_set_template_id column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'rotation_assignments'
      AND column_name  = 'duty_set_template_id'
  ) THEN
    ALTER TABLE public.rotation_assignments ADD COLUMN duty_set_template_id UUID;
  END IF;

  -- Add department_id column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'rotation_assignments'
      AND column_name  = 'department_id'
  ) THEN
    ALTER TABLE public.rotation_assignments ADD COLUMN department_id UUID;
  END IF;

  -- Add tenant_id column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'rotation_assignments'
      AND column_name  = 'tenant_id'
  ) THEN
    ALTER TABLE public.rotation_assignments ADD COLUMN tenant_id UUID NOT NULL DEFAULT gen_random_uuid();
  END IF;

END $$;

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_rotation_assignments_tenant_dept_date
  ON public.rotation_assignments (tenant_id, department_id, date);

CREATE INDEX IF NOT EXISTS idx_rotation_assignments_member_date
  ON public.rotation_assignments (member_id, date);

-- Enable RLS
ALTER TABLE public.rotation_assignments ENABLE ROW LEVEL SECURITY;

-- RLS: tenant members can read their own tenant's assignments
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'rotation_assignments'
      AND policyname = 'rotation_assignments_select_tenant'
  ) THEN
    CREATE POLICY rotation_assignments_select_tenant
      ON public.rotation_assignments
      FOR SELECT
      USING (
        tenant_id IN (
          SELECT tenant_id FROM public.tenant_members
          WHERE user_id = auth.uid() AND active = true
        )
      );
  END IF;
END $$;

-- RLS: COMMAND/CHIEF/HOD can insert/update/delete
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'rotation_assignments'
      AND policyname = 'rotation_assignments_write_command_chief'
  ) THEN
    CREATE POLICY rotation_assignments_write_command_chief
      ON public.rotation_assignments
      FOR ALL
      USING (
        tenant_id IN (
          SELECT tenant_id FROM public.tenant_members
          WHERE user_id = auth.uid()
            AND active = true
            AND permission_tier IN ('COMMAND', 'CHIEF', 'HOD')
        )
      )
      WITH CHECK (
        tenant_id IN (
          SELECT tenant_id FROM public.tenant_members
          WHERE user_id = auth.uid()
            AND active = true
            AND permission_tier IN ('COMMAND', 'CHIEF', 'HOD')
        )
      );
  END IF;
END $$;

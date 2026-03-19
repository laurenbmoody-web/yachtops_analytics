-- Migration: Add role_id column to tenant_members
-- Purpose: Replace job_titles_catalog with public.roles table
-- Date: 2026-02-17

-- Add role_id column to tenant_members (nullable, references roles.id)
ALTER TABLE public.tenant_members
ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES public.roles(id);

-- Add department_id column if it doesn't exist (should already exist but ensuring idempotency)
ALTER TABLE public.tenant_members
ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id);

-- Add permission_tier_override column if it doesn't exist
ALTER TABLE public.tenant_members
ADD COLUMN IF NOT EXISTS permission_tier_override TEXT CHECK (
  permission_tier_override IS NULL OR 
  permission_tier_override IN ('COMMAND', 'CHIEF', 'HOD', 'CREW')
);

-- Add permission_override_enabled column if it doesn't exist
ALTER TABLE public.tenant_members
ADD COLUMN IF NOT EXISTS permission_override_enabled BOOLEAN DEFAULT false;

-- Create index on role_id for better query performance
CREATE INDEX IF NOT EXISTS idx_tenant_members_role_id ON public.tenant_members(role_id);

-- Create index on department_id for better query performance
CREATE INDEX IF NOT EXISTS idx_tenant_members_department_id ON public.tenant_members(department_id);
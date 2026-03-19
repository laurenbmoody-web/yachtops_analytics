-- Migration: Add updated_at column to tenant_members table
-- Purpose: Fix PGRST204 error - schema cache expects updated_at column
-- Date: 2026-02-17

-- Add updated_at column to tenant_members
ALTER TABLE public.tenant_members
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Create trigger to automatically update updated_at on row updates
CREATE OR REPLACE FUNCTION public.handle_tenant_members_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Drop trigger if it exists (idempotent)
DROP TRIGGER IF EXISTS set_tenant_members_updated_at ON public.tenant_members;

-- Create trigger on tenant_members
CREATE TRIGGER set_tenant_members_updated_at
  BEFORE UPDATE ON public.tenant_members
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_tenant_members_updated_at();

-- Backfill existing rows with current timestamp
UPDATE public.tenant_members
SET updated_at = COALESCE(joined_at, now())
WHERE updated_at IS NULL;
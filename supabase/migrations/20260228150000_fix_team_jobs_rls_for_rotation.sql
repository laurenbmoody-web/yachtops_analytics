-- Migration: Fix team_jobs RLS to allow rotation calendar to create jobs for any crew member
-- Root cause: INSERT policy blocked COMMAND/CHIEF users from inserting jobs assigned to other users
-- The rotation calendar runs as the logged-in COMMAND/CHIEF user but assigns jobs to crew members
-- This migration adds a permissive policy scoped to the tenant (not just auth.uid())

-- Ensure RLS is enabled on team_jobs
ALTER TABLE public.team_jobs ENABLE ROW LEVEL SECURITY;

-- ── SELECT: Any tenant member can read jobs in their tenant ──
DROP POLICY IF EXISTS "tenant_members_select_team_jobs" ON public.team_jobs;
CREATE POLICY "tenant_members_select_team_jobs"
  ON public.team_jobs
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid() AND active = true
    )
  );

-- ── INSERT: Any tenant member can insert jobs within their tenant ──
-- This is required so COMMAND/CHIEF users can create rotation jobs assigned to crew members
DROP POLICY IF EXISTS "tenant_members_insert_team_jobs" ON public.team_jobs;
CREATE POLICY "tenant_members_insert_team_jobs"
  ON public.team_jobs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid() AND active = true
    )
  );

-- ── UPDATE: Any tenant member can update jobs within their tenant ──
DROP POLICY IF EXISTS "tenant_members_update_team_jobs" ON public.team_jobs;
CREATE POLICY "tenant_members_update_team_jobs"
  ON public.team_jobs
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid() AND active = true
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid() AND active = true
    )
  );

-- ── DELETE: Any tenant member can delete jobs within their tenant ──
DROP POLICY IF EXISTS "tenant_members_delete_team_jobs" ON public.team_jobs;
CREATE POLICY "tenant_members_delete_team_jobs"
  ON public.team_jobs
  FOR DELETE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid() AND active = true
    )
  );

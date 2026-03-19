-- Add completed_at and completed_by columns to team_jobs if not present
ALTER TABLE public.team_jobs
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_by UUID,
  ADD COLUMN IF NOT EXISTS completion_date DATE;

-- Create job_history table to store completed jobs
CREATE TABLE IF NOT EXISTS public.job_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  original_job_id UUID,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT,
  department_id UUID,
  department TEXT,
  board_id TEXT,
  board_name TEXT,
  assigned_to UUID,
  created_by UUID,
  completed_by UUID,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completion_date DATE NOT NULL DEFAULT CURRENT_DATE,
  metadata JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_history_tenant_id ON public.job_history(tenant_id);
CREATE INDEX IF NOT EXISTS idx_job_history_completion_date ON public.job_history(completion_date);
CREATE INDEX IF NOT EXISTS idx_job_history_tenant_date ON public.job_history(tenant_id, completion_date);

ALTER TABLE public.job_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_members_manage_job_history" ON public.job_history;
CREATE POLICY "tenant_members_manage_job_history"
  ON public.job_history
  FOR ALL
  TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
  ))
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
  ));

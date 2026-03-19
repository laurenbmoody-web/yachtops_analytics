-- Create job_boards table to persist board configurations (names) per tenant/department
-- This ensures board name changes by COMMAND/CHIEF users are visible to all users

CREATE TABLE IF NOT EXISTS public.job_boards (
  id TEXT NOT NULL,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  department_id UUID REFERENCES public.departments(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Additional jobs',
  description TEXT,
  board_type TEXT DEFAULT 'Interior',
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_job_boards_tenant_id ON public.job_boards(tenant_id);
CREATE INDEX IF NOT EXISTS idx_job_boards_tenant_dept ON public.job_boards(tenant_id, department_id);

ALTER TABLE public.job_boards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_members_manage_job_boards" ON public.job_boards;
CREATE POLICY "tenant_members_manage_job_boards"
  ON public.job_boards
  FOR ALL
  TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
  ))
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
  ));

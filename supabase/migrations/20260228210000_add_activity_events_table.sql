-- Activity Events Table
-- Stores all operational activity events for jobs, inventory, and defects modules
-- RLS: tenant-scoped with role-based visibility

CREATE TABLE IF NOT EXISTS public.activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_user_id UUID,
  actor_name TEXT NOT NULL DEFAULT 'Unknown User',
  actor_department TEXT,
  actor_role_tier TEXT,
  department_scope TEXT,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  summary TEXT NOT NULL,
  meta JSONB DEFAULT '{}'::jsonb
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_activity_events_tenant_id ON public.activity_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_activity_events_created_at ON public.activity_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_events_actor_user_id ON public.activity_events(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_activity_events_department_scope ON public.activity_events(department_scope);
CREATE INDEX IF NOT EXISTS idx_activity_events_module ON public.activity_events(module);
CREATE INDEX IF NOT EXISTS idx_activity_events_entity ON public.activity_events(entity_type, entity_id);

-- Enable RLS
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

-- RLS: Tenant members can INSERT their own events
DROP POLICY IF EXISTS "activity_events_insert" ON public.activity_events;
CREATE POLICY "activity_events_insert"
  ON public.activity_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = activity_events.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active = true
    )
  );

-- RLS: Tenant members can SELECT events from their tenant
DROP POLICY IF EXISTS "activity_events_select" ON public.activity_events;
CREATE POLICY "activity_events_select"
  ON public.activity_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = activity_events.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active = true
    )
  );

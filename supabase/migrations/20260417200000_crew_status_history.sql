-- Migration: Crew status history audit log
-- Date: 2026-04-17
--
-- Creates crew_status_history table, RLS policies, and an INSERT trigger on
-- tenant_members so that every new member's initial status is logged automatically.
-- Status *changes* are logged by the application layer (no UPDATE trigger) to
-- allow notes to be included in the same row without a second roundtrip.

-- ────────────────────────────────────────────────────────────
-- 1. Table
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crew_status_history (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES auth.users(id)     ON DELETE CASCADE,
  old_status    TEXT,
  new_status    TEXT        NOT NULL,
  changed_by    UUID        REFERENCES auth.users(id),
  changed_by_name TEXT,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_crew_status_history_user
  ON public.crew_status_history(user_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_crew_status_history_tenant
  ON public.crew_status_history(tenant_id, changed_at DESC);

-- ────────────────────────────────────────────────────────────
-- 2. RLS
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.crew_status_history ENABLE ROW LEVEL SECURITY;

-- Any active member of the tenant can read their tenant's history
DROP POLICY IF EXISTS "crew_status_history_select" ON public.crew_status_history;
CREATE POLICY "crew_status_history_select"
  ON public.crew_status_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = crew_status_history.tenant_id
        AND tm.user_id   = auth.uid()
        AND tm.active    = true
    )
  );

-- Authenticated members can insert history rows for their tenant.
-- The real write-gate is the tenant_members.status UPDATE permission; this
-- policy just ensures you can only log changes under your own auth.uid().
DROP POLICY IF EXISTS "crew_status_history_insert" ON public.crew_status_history;
CREATE POLICY "crew_status_history_insert"
  ON public.crew_status_history FOR INSERT
  TO authenticated
  WITH CHECK (
    changed_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = crew_status_history.tenant_id
        AND tm.user_id   = auth.uid()
        AND tm.active    = true
    )
  );

-- ────────────────────────────────────────────────────────────
-- 3. INSERT trigger — log the initial status when a member joins
--    (fires from accept_crew_invite_v3 which runs SECURITY DEFINER,
--    so auth.uid() is the invitee who just accepted the invite)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_crew_status_initial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
BEGIN
  SELECT full_name INTO v_name
  FROM public.profiles
  WHERE id = NEW.user_id;

  INSERT INTO public.crew_status_history (
    tenant_id, user_id,
    old_status, new_status,
    changed_by, changed_by_name
  ) VALUES (
    NEW.tenant_id, NEW.user_id,
    NULL, COALESCE(NEW.status, 'active'),
    auth.uid(), COALESCE(v_name, 'System')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crew_status_initial ON public.tenant_members;
CREATE TRIGGER trg_crew_status_initial
  AFTER INSERT ON public.tenant_members
  FOR EACH ROW
  EXECUTE FUNCTION public.log_crew_status_initial();

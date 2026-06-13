-- ─────────────────────────────────────────────────────────────────────────────
-- 20260613120000_hor_work_entries.sql
--
-- WHAT: Persist HOR work ACTUALS in the database (Phase 5 part 2) — the system
--       of record for each crew member's logged on-duty 30-min blocks per day,
--       replacing the per-device localStorage 'cargo_hor_entries' store.
--
--       ONLY actuals (source='edited') live here. The rota-derived BASELINE is
--       NOT persisted — it is recomputed from rota_shifts on read (Phase 1), so
--       merely viewing a crew member's HOR never writes baseline rows for them.
--
--       work_segments: smallint[] of 30-min block indices (0–47) worked on the
--       day, matching the frontend grid. Empty array = a logged all-rest day.
--
-- ACCESS: tenant members read (command/approver need to see crew records); a
--       crew member writes their own day, and COMMAND may write any. Writes are
--       direct (RLS-guarded) rather than RPC — high-frequency quick-entry edits.
--
-- IDEMPOTENCY: CREATE TABLE/POLICY IF NOT EXISTS + CREATE OR REPLACE FUNCTION.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hor_work_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subject_user_id uuid NOT NULL,                  -- crew member (profiles.id / auth uid)
  entry_date      date NOT NULL,
  work_segments   smallint[] NOT NULL DEFAULT '{}',
  source          text NOT NULL DEFAULT 'edited',
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hor_work_entries_unique UNIQUE (tenant_id, subject_user_id, entry_date)
);

CREATE INDEX IF NOT EXISTS hor_work_entries_subject_idx
  ON public.hor_work_entries (tenant_id, subject_user_id, entry_date);

-- Write predicate: self, or COMMAND in the same tenant. SECURITY DEFINER so the
-- tenant_members lookup isn't itself gated by RLS recursion.
CREATE OR REPLACE FUNCTION public.hor_can_write_entries(p_tenant_id uuid, p_subject uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.user_id = auth.uid()
      AND tm.tenant_id = p_tenant_id
      AND tm.active = true
      AND (p_subject = auth.uid() OR tm.permission_tier = 'COMMAND')
  );
$$;
GRANT EXECUTE ON FUNCTION public.hor_can_write_entries(uuid, uuid) TO authenticated;

ALTER TABLE public.hor_work_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='hor_work_entries' AND policyname='hor_work_entries_read') THEN
    CREATE POLICY "hor_work_entries_read" ON public.hor_work_entries
      FOR SELECT USING (public.is_active_tenant_member(tenant_id, auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='hor_work_entries' AND policyname='hor_work_entries_insert') THEN
    CREATE POLICY "hor_work_entries_insert" ON public.hor_work_entries
      FOR INSERT WITH CHECK (public.hor_can_write_entries(tenant_id, subject_user_id));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='hor_work_entries' AND policyname='hor_work_entries_update') THEN
    CREATE POLICY "hor_work_entries_update" ON public.hor_work_entries
      FOR UPDATE USING (public.hor_can_write_entries(tenant_id, subject_user_id))
                 WITH CHECK (public.hor_can_write_entries(tenant_id, subject_user_id));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='hor_work_entries' AND policyname='hor_work_entries_delete') THEN
    CREATE POLICY "hor_work_entries_delete" ON public.hor_work_entries
      FOR DELETE USING (public.hor_can_write_entries(tenant_id, subject_user_id));
  END IF;
END $$;

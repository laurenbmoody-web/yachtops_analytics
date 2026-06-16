-- ─────────────────────────────────────────────────────────────────────────────
-- 20260615151000_hor_segment_types_and_templates.sql
--
-- Note: original timestamp 20260615150000 collided with
-- 20260615150000_crew_personal_details_preferred_name_pronouns.sql, which
-- had been applied via Studio before this CI flow caught up. Bumped to
-- 20260615151000 so the schema_migrations primary key (version) is
-- unique. SQL itself is fully idempotent (CREATE TABLE / ADD COLUMN
-- IF NOT EXISTS throughout), so re-running it after Studio-applied
-- changes is a NOTICE-only operation.
--
-- WHAT: Bring the personal HOR logger to parity with the rota — capture the
--       SHIFT TYPE of each logged block, and let crew keep their own reusable
--       shift templates for bulk-adding repetitive days.
--
--   1) hor_work_entries.segment_types — jsonb map of 30-min block index → type
--      ('duty' | 'watch' | 'standby' | 'training'), matching the rota's
--      shift_type vocabulary (restHours.ON_DUTY_TYPES). Blocks present in
--      work_segments but absent from this map default to 'duty' in the app.
--      Empty map = an all-duty day. Type does NOT affect the rest maths (every
--      on-duty type counts equally) — it's for the record + rota consistency.
--
--   2) hor_shift_templates — USER-scoped reusable patterns (NOT vessel/role
--      scoped: each crew member keeps their own). Stores the same segment +
--      type shape so a template applies exactly like a logged day.
--
-- IDEMPOTENCY: ADD COLUMN IF NOT EXISTS / CREATE TABLE|POLICY IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Per-segment shift type on actuals.
ALTER TABLE public.hor_work_entries
  ADD COLUMN IF NOT EXISTS segment_types jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2) User-scoped shift templates.
CREATE TABLE IF NOT EXISTS public.hor_shift_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  uuid NOT NULL DEFAULT auth.uid(),   -- the crew member who owns it
  name           text NOT NULL,
  work_segments  smallint[] NOT NULL DEFAULT '{}',
  segment_types  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hor_shift_templates_owner_idx
  ON public.hor_shift_templates (owner_user_id);

ALTER TABLE public.hor_shift_templates ENABLE ROW LEVEL SECURITY;

-- Owner-only: a user sees and manages only their own templates.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='hor_shift_templates' AND policyname='hor_shift_templates_owner_all') THEN
    CREATE POLICY "hor_shift_templates_owner_all" ON public.hor_shift_templates
      FOR ALL USING (owner_user_id = auth.uid())
              WITH CHECK (owner_user_id = auth.uid());
  END IF;
END $$;

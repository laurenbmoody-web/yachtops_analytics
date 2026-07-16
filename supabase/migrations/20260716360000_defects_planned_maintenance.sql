-- ─────────────────────────────────────────────────────────────────────────────
-- 20260716360000_defects_planned_maintenance.sql
--
-- WHAT: Promote a recurring defect into a planned maintenance job — turn a fault
--       that keeps coming back into preventive upkeep. Mirrors the rotation
--       origin-tag pattern (team_jobs.source + rotation_assignment_id):
--   • team_jobs.source_defect_id  — the defect this job was created from.
--   • team_jobs.recurrence        — a repeat descriptor ('monthly'/'quarterly'/
--                                   'biannual'/'annual'); null = one-off. (No
--                                   auto-regeneration yet — a later cron/edge can
--                                   clone the next occurrence on completion.)
--   • defects.promoted_job_id     — the job the defect spawned (two-way link).
--
-- Bare uuids (no FK), matching the existing rotation_assignment_id column, since
-- the team_jobs base table lives outside migration history.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.team_jobs
  ADD COLUMN IF NOT EXISTS source_defect_id uuid,
  ADD COLUMN IF NOT EXISTS recurrence       text;

ALTER TABLE public.defects
  ADD COLUMN IF NOT EXISTS promoted_job_id uuid;

CREATE INDEX IF NOT EXISTS idx_team_jobs_source_defect
  ON public.team_jobs (source_defect_id) WHERE source_defect_id IS NOT NULL;

-- Migration: Link rotation_assignments to team_jobs
-- Adds source tracking and bidirectional link between rotation calendar and team jobs
-- Safe to run multiple times (idempotent)

DO $$
BEGIN

  -- Add 'source' column to team_jobs to mark rotation-generated jobs
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'team_jobs'
      AND column_name  = 'source'
  ) THEN
    ALTER TABLE public.team_jobs ADD COLUMN source TEXT DEFAULT NULL;
    COMMENT ON COLUMN public.team_jobs.source IS 'Origin of the job: NULL = manual, ''rotation'' = auto-created from rotation calendar (read-only tag)';
  END IF;

  -- Add 'rotation_assignment_id' column to team_jobs to link back to the rotation assignment
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'team_jobs'
      AND column_name  = 'rotation_assignment_id'
  ) THEN
    ALTER TABLE public.team_jobs ADD COLUMN rotation_assignment_id UUID DEFAULT NULL;
    COMMENT ON COLUMN public.team_jobs.rotation_assignment_id IS 'FK to rotation_assignments.id — set when job was auto-created from rotation calendar';
  END IF;

  -- Add 'linked_job_id' column to rotation_assignments to link forward to the team_job
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'rotation_assignments'
      AND column_name  = 'linked_job_id'
  ) THEN
    ALTER TABLE public.rotation_assignments ADD COLUMN linked_job_id UUID DEFAULT NULL;
    COMMENT ON COLUMN public.rotation_assignments.linked_job_id IS 'FK to team_jobs.id — the auto-created job for this rotation assignment';
  END IF;

END $$;

-- Index for fast lookup of rotation-generated jobs
CREATE INDEX IF NOT EXISTS idx_team_jobs_rotation_assignment_id
  ON public.team_jobs (rotation_assignment_id)
  WHERE rotation_assignment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_team_jobs_source
  ON public.team_jobs (source)
  WHERE source IS NOT NULL;

-- Add metadata column to team_jobs for change history tracking
-- metadata stores a JSONB array of change entries:
-- [{ timestamp, user_id, user_name, user_tier, field, old_value, new_value }]

ALTER TABLE public.team_jobs
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.team_jobs.metadata IS 'Change history log: array of {timestamp, user_id, user_name, user_tier, field, old_value, new_value}. Viewable only by COMMAND and CHIEF tiers.';

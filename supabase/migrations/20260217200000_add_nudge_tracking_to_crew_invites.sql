-- Migration: Add nudge tracking fields to crew_invites
-- Created: 2026-02-17
-- Purpose: Track nudge/reminder emails separately from invite resends

-- Add nudge tracking columns to crew_invites
ALTER TABLE public.crew_invites
ADD COLUMN IF NOT EXISTS last_nudged_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS nudge_count INTEGER DEFAULT 0;

-- Add comment for clarity
COMMENT ON COLUMN public.crew_invites.last_nudged_at IS 'Timestamp of last nudge/reminder email sent';
COMMENT ON COLUMN public.crew_invites.nudge_count IS 'Number of nudge/reminder emails sent';
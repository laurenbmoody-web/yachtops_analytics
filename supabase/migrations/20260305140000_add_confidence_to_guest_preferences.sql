-- Add confidence column to guest_preferences table
-- Allowed values: confirmed | observed | suggested

ALTER TABLE public.guest_preferences
  ADD COLUMN IF NOT EXISTS confidence TEXT DEFAULT NULL;

-- Optional: add a check constraint for allowed values
ALTER TABLE public.guest_preferences
  DROP CONSTRAINT IF EXISTS guest_preferences_confidence_check;

ALTER TABLE public.guest_preferences
  ADD CONSTRAINT guest_preferences_confidence_check
  CHECK (confidence IS NULL OR confidence IN ('confirmed', 'observed', 'suggested'));

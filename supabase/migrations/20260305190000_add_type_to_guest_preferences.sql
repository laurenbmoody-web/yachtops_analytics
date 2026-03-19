-- Add type column to guest_preferences table
-- Allowed values: preference | avoid
-- Existing records default to 'preference'

ALTER TABLE public.guest_preferences
  ADD COLUMN IF NOT EXISTS pref_type TEXT NOT NULL DEFAULT 'preference';

-- Drop and recreate check constraint for allowed values
ALTER TABLE public.guest_preferences
  DROP CONSTRAINT IF EXISTS guest_preferences_pref_type_check;

ALTER TABLE public.guest_preferences
  ADD CONSTRAINT guest_preferences_pref_type_check
  CHECK (pref_type IN ('preference', 'avoid'));

-- Backfill existing rows to 'preference'
UPDATE public.guest_preferences
  SET pref_type = 'preference'
  WHERE pref_type IS NULL OR pref_type = '';

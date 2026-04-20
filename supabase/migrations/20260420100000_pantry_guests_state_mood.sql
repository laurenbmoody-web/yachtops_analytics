-- Add pantry-required columns to guests table
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS current_mood        text,
  ADD COLUMN IF NOT EXISTS current_mood_emoji  text,
  ADD COLUMN IF NOT EXISTS current_state       text
    CHECK (current_state IN ('awake', 'asleep', 'ashore'))
    DEFAULT 'awake',
  ADD COLUMN IF NOT EXISTS ashore_context      jsonb,
  ADD COLUMN IF NOT EXISTS onboard_since       timestamptz;

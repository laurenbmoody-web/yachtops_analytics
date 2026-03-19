-- Add time_of_day column to guest_preferences table
ALTER TABLE public.guest_preferences
ADD COLUMN IF NOT EXISTS time_of_day TEXT DEFAULT NULL;

-- Add is_active_on_trip flag to guests
-- Toggled from guest management to include a guest on the pantry/interior dashboard
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS is_active_on_trip BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_guests_is_active_on_trip ON public.guests(is_active_on_trip);

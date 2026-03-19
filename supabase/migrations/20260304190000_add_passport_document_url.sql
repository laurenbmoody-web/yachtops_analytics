-- Add passport_document_url column to guests table
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS passport_document_url text;

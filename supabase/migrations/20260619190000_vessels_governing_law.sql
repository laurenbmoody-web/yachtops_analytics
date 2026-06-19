ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS governing_law text;

COMMENT ON COLUMN public.vessels.governing_law IS
  'Governing law of the vessel''s employment agreements (e.g. England & Wales). Vessel-level; inherited read-only onto crew profiles.';

-- Inline complete / uncomplete on stew_notes.
--
-- The standby StewNotesWidget becomes the primary authoring surface for
-- stew notes. Adding completed_at / completed_by lets the widget filter
-- the active list (completed_at IS NULL) and the modal render a
-- "DONE TODAY" section with completion attribution.
--
-- related_guest_id is already nullable on the table (no NOT NULL on the
-- create migration) — unscoped notes are a valid first-class shape, no
-- backfill needed.
--
-- Index on completed_at speeds the active filter, which fires on every
-- standby page load.

ALTER TABLE public.stew_notes
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_stew_notes_completed_at ON public.stew_notes(completed_at);

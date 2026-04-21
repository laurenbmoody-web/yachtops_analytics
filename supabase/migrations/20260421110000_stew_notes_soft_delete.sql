-- Soft-delete for stew_notes
-- NotesHistoryPage and StewNotesWidget filter out is_deleted rows so that
-- destructive "Delete" actions on a note are reversible via audit/restore.

ALTER TABLE public.stew_notes
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by_user_id uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_stew_notes_is_deleted ON public.stew_notes(is_deleted);

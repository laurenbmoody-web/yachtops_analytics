-- ─────────────────────────────────────────────────────────────────────────────
-- 20260713170000_provisioning_lists_archived_at.sql
--
-- Adds provisioning_lists.archived_at — a soft "close" for finished boards.
--
-- When a board's delivery is done and the invoice paid, the crew wants to
-- close it out of the active kanban WITHOUT deleting the record (needed for
-- month-end / audit history). archived_at is that lever: non-null = closed.
-- The board list excludes archived boards by default; an "Archived" view
-- surfaces them for reference or un-archiving (archived_at back to null).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.provisioning_lists
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Partial index — the active-boards query filters on archived_at IS NULL.
CREATE INDEX IF NOT EXISTS idx_provisioning_lists_active
  ON public.provisioning_lists (tenant_id)
  WHERE archived_at IS NULL;

COMMENT ON COLUMN public.provisioning_lists.archived_at IS
  'Soft close. Non-null = the board is archived (finished — delivered &
   paid) and hidden from the active kanban, but retained for history. Set
   back to null to un-archive. Distinct from deletion (delete_provisioning_board).';

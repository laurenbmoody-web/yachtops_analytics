-- ─────────────────────────────────────────────────────────────────────────────
-- 20260716220000_provisioning_lists_source_defect.sql
--
-- WHAT: Let a provisioning requisition (list) record the defect it was raised
--       from, so "order parts to fix this defect" is traceable both ways —
--       the defect shows its parts requisitions, and the board knows its origin.
--
--       ON DELETE SET NULL: deleting a defect must not cascade-delete the
--       requisition/order history; it just drops the back-link.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS + partial index.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.provisioning_lists
  ADD COLUMN IF NOT EXISTS source_defect_id uuid
    REFERENCES public.defects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_provisioning_lists_source_defect
  ON public.provisioning_lists (source_defect_id)
  WHERE source_defect_id IS NOT NULL;

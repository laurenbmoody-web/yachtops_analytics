-- ─────────────────────────────────────────────────────────────────────────────
-- 20260716260000_defects_warranty.sql
--
-- WHAT: Warranty-until date on a completed repair. If the same fault recurs at
--       the same location while a prior repair there is still under warranty,
--       the app flags a possible warranty claim (no free re-work).
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS + partial index for the recurrence lookup.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.defects
  ADD COLUMN IF NOT EXISTS warranty_until date;

CREATE INDEX IF NOT EXISTS idx_defects_warranty_location
  ON public.defects (tenant_id, location_node_id, warranty_until)
  WHERE warranty_until IS NOT NULL AND location_node_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260518000010_alter_rota_shifts_add_status.sql
--
-- WHAT: Adds `status` text column to public.rota_shifts to support per-shift
--       draft/published state required by the Phase 1 rota builder edit mode.
--
-- WHY: Phase 1 (commit 3fb3a6c) introduced a SELECT on rota_shifts.status in
--      useRotaShifts.js. The column does not yet exist in production. This
--      migration adds it. All existing rows are backfilled to 'published'
--      since they represent finalized shifts that were live before draft
--      semantics existed.
--
-- NOT A RECOVERY MIGRATION: this is a forward-going schema change. Idempotent
--      via IF NOT EXISTS guards so it can be applied to any environment that
--      already has the column.
--
-- ROLLBACK: ALTER TABLE rota_shifts DROP COLUMN status;
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add column nullable first so the table doesn't error on the ADD
ALTER TABLE public.rota_shifts
  ADD COLUMN IF NOT EXISTS status text;

-- 2. Backfill all existing rows to 'published' (they represent live shifts)
UPDATE public.rota_shifts
SET status = 'published'
WHERE status IS NULL;

-- 3. Now enforce NOT NULL + default + CHECK
DO $$
BEGIN
  -- Set NOT NULL only after backfill completes successfully
  IF NOT EXISTS (SELECT 1 FROM public.rota_shifts WHERE status IS NULL) THEN
    BEGIN
      ALTER TABLE public.rota_shifts
        ALTER COLUMN status SET NOT NULL;
    EXCEPTION WHEN others THEN
      -- already NOT NULL or transient — non-fatal in idempotent migration
      NULL;
    END;
  END IF;
END $$;

-- 4. Default for future inserts (Phase 1 inserts use 'draft' explicitly,
--    but a default of 'draft' makes the column safe for any future inserter)
ALTER TABLE public.rota_shifts
  ALTER COLUMN status SET DEFAULT 'draft';

-- 5. CHECK constraint to enforce valid values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rota_shifts_status_check'
      AND conrelid = 'public.rota_shifts'::regclass
  ) THEN
    ALTER TABLE public.rota_shifts
      ADD CONSTRAINT rota_shifts_status_check
        CHECK (status = ANY (ARRAY['draft'::text, 'published'::text]));
  END IF;
END $$;

-- 6. Index for queries that filter by status (e.g. draft counts per dept)
CREATE INDEX IF NOT EXISTS idx_rota_shifts_status
  ON public.rota_shifts USING btree (status)
  WHERE (status = 'draft'::text);
-- Partial index on draft only — published is the bulk; draft is what we filter for.

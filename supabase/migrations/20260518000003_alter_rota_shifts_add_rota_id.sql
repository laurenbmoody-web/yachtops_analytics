-- ─────────────────────────────────────────────────────────────────────────────
-- 20260518000003_alter_rota_shifts_add_rota_id.sql
--
-- WHAT: Adds rota_shifts.rota_id (uuid NOT NULL, NO foreign key — matches live),
--       its supporting index idx_rota_shifts_rota, and the step-4 ADDITIVE HOD
--       write policy (a): an HOD may write rota_shifts for crew members in
--       their own department. Existing live policies (rota_shifts_tenant_read,
--       rota_shifts_command_chief_write) are intentionally left UNTOUCHED.
--
-- RECOVERY MIGRATION: the column + index are ALREADY LIVE. No-op on prod.
--
-- IDEMPOTENCY: ADD COLUMN IF NOT EXISTS; reconstruction backfill guarded by
--       `rota_id IS NULL` (matches zero rows on prod, where it is already
--       populated & NOT NULL); SET NOT NULL applied conditionally only when no
--       NULLs remain; CREATE INDEX IF NOT EXISTS; DROP POLICY IF EXISTS/CREATE.
--
-- AUDIT NOTES / QUIRKS — READ THIS:
--   * rota_shifts has NO committed CREATE TABLE anywhere in the repo (same
--     out-of-band drift as the rota-builder tables). On a TRULY FRESH database
--     this ALTER will fail (no rota_shifts table). Recovering rota_shifts's
--     base schema is OUT OF SCOPE for this Phase-0.5 batch and must be a
--     separate follow-up; flagged in the report.
--   * rota_shifts.rota_id has NO foreign key to rotas(id) in production, even
--     though every OTHER rota_id column in the schema is FK→rotas ON DELETE
--     CASCADE. We reproduce the live shape (no FK). This is a real referential-
--     integrity gap — flagged for a future migration, NOT fixed here.
--   * The ORIGINAL "migration 3" backfill logic was never committed and is
--     lost. The UPDATE below is a BEST-EFFORT RECONSTRUCTION (trip shifts →
--     that trip's rota; non-trip shifts → the tenant's vessel standing rota).
--     It is a guaranteed no-op on prod (rota_id already populated) and on a
--     fresh DB (rota_shifts empty). It only acts in partial environments and
--     may not match the original mapping — flagged.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.rota_shifts
  ADD COLUMN IF NOT EXISTS rota_id uuid;

-- Best-effort reconstruction backfill (see header note). No-op on prod.
UPDATE public.rota_shifts s
SET rota_id = r.id
FROM public.rotas r
WHERE s.rota_id IS NULL
  AND r.tenant_id = s.tenant_id
  AND (
        (s.trip_id IS NOT NULL AND r.owner_type = 'trip'   AND r.trip_id = s.trip_id)
     OR (s.trip_id IS NULL     AND r.owner_type = 'vessel')
      );

-- Enforce NOT NULL only when the column is fully populated. On prod this is a
-- no-op (already NOT NULL); the guard prevents failure in partial envs.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.rota_shifts WHERE rota_id IS NULL) THEN
    BEGIN
      ALTER TABLE public.rota_shifts ALTER COLUMN rota_id SET NOT NULL;
    EXCEPTION WHEN others THEN
      -- already NOT NULL, or transient; recovery migration stays non-fatal
      NULL;
    END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rota_shifts_rota
  ON public.rota_shifts USING btree (rota_id);

-- ── RLS: step-4 ADDITIVE HOD policy (a) — does NOT alter live policies ────────
DROP POLICY IF EXISTS "rota_shifts_hod_own_dept_write" ON public.rota_shifts;
CREATE POLICY "rota_shifts_hod_own_dept_write" ON public.rota_shifts FOR ALL
  USING (
    member_id IN (
      SELECT crew.id
      FROM public.tenant_members crew
      JOIN public.tenant_members hod
        ON hod.tenant_id     = crew.tenant_id
       AND hod.department_id = crew.department_id
      WHERE hod.user_id = auth.uid()
        AND hod.active = true
        AND hod.permission_tier = 'HOD'
        AND crew.tenant_id = rota_shifts.tenant_id))
  WITH CHECK (
    member_id IN (
      SELECT crew.id
      FROM public.tenant_members crew
      JOIN public.tenant_members hod
        ON hod.tenant_id     = crew.tenant_id
       AND hod.department_id = crew.department_id
      WHERE hod.user_id = auth.uid()
        AND hod.active = true
        AND hod.permission_tier = 'HOD'
        AND crew.tenant_id = rota_shifts.tenant_id));

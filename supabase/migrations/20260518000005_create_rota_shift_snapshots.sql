-- ─────────────────────────────────────────────────────────────────────────────
-- 20260518000005_create_rota_shift_snapshots.sql
--
-- WHAT: Creates public.rota_shift_snapshots — immutable point-in-time captures
--       of a department's shifts at publish. Includes constraints, indexes and
--       step-3 baseline RLS (tenant read / COMMAND-CHIEF write).
--
-- RECOVERY MIGRATION: schema is ALREADY LIVE. No-op on prod. (Snapshots table
--       is expected EMPTY until the first publish; this file creates structure
--       only — it inserts no data.)
--
-- IDEMPOTENCY: CREATE TABLE IF NOT EXISTS; CREATE INDEX IF NOT EXISTS; ENABLE
--       RLS no-op if enabled; DROP POLICY IF EXISTS before CREATE POLICY.
--
-- AUDIT NOTES / QUIRKS:
--   * vessel_id NOT NULL, NO FK (live shape; reproduced as-is).
--   * department_id FK → departments(id) ON DELETE RESTRICT.
--   * No write access for HOD here by design — snapshots are written on
--     publish, which is a COMMAND/CHIEF action (baseline policy suffices).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rota_shift_snapshots (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  rota_id            uuid        NOT NULL,
  department_id      uuid        NOT NULL,
  tenant_id          uuid        NOT NULL,
  vessel_id          uuid        NOT NULL,
  snapshot_taken_at  timestamptz NOT NULL DEFAULT now(),
  snapshot_taken_by  uuid        NOT NULL,
  shift_data         jsonb       NOT NULL,
  date_start         date        NOT NULL,
  date_end           date        NOT NULL,
  shift_count        integer     NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rota_shift_snapshots_pkey PRIMARY KEY (id),
  CONSTRAINT rota_shift_snapshots_rota_id_fkey
    FOREIGN KEY (rota_id) REFERENCES public.rotas(id) ON DELETE CASCADE,
  CONSTRAINT rota_shift_snapshots_department_id_fkey
    FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE RESTRICT,
  CONSTRAINT rota_shift_snapshots_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT rota_shift_snapshots_snapshot_taken_by_fkey
    FOREIGN KEY (snapshot_taken_by) REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_rota_snapshots_rota_dept
  ON public.rota_shift_snapshots USING btree (rota_id, department_id, snapshot_taken_at DESC);
CREATE INDEX IF NOT EXISTS idx_rota_snapshots_tenant
  ON public.rota_shift_snapshots USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_rota_snapshots_vessel
  ON public.rota_shift_snapshots USING btree (vessel_id);

-- ── RLS: step-3 baseline ─────────────────────────────────────────────────────
ALTER TABLE public.rota_shift_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rota_shift_snapshots_tenant_read" ON public.rota_shift_snapshots;
CREATE POLICY "rota_shift_snapshots_tenant_read" ON public.rota_shift_snapshots FOR SELECT
  USING (tenant_id IN (
    SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = auth.uid() AND tm.active = true));

DROP POLICY IF EXISTS "rota_shift_snapshots_command_chief_write" ON public.rota_shift_snapshots;
CREATE POLICY "rota_shift_snapshots_command_chief_write" ON public.rota_shift_snapshots FOR ALL
  USING (tenant_id IN (
    SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = auth.uid() AND tm.active = true
      AND tm.permission_tier = ANY (ARRAY['COMMAND'::text, 'CHIEF'::text])));

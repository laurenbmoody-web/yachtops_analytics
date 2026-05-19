-- ─────────────────────────────────────────────────────────────────────────────
-- 20260518000004_create_rota_department_status.sql
--
-- WHAT: Creates public.rota_department_status — per-(rota,department) workflow
--       state (draft / pending_approval / published). Includes constraints,
--       indexes, step-3 baseline RLS, and the step-4 ADDITIVE HOD submit
--       policy (b).
--
-- RECOVERY MIGRATION: schema is ALREADY LIVE. No-op on prod.
--
-- IDEMPOTENCY: CREATE TABLE IF NOT EXISTS; CREATE INDEX IF NOT EXISTS; ENABLE
--       RLS no-op if enabled; DROP POLICY IF EXISTS before CREATE POLICY.
--
-- AUDIT NOTES / QUIRKS:
--   * vessel_id NOT NULL, NO FK (live shape; reproduced as-is).
--   * department_id FK → departments(id) ON DELETE RESTRICT (global table).
--   * UNIQUE (rota_id, department_id) — one status row per dept per rota.
--   * No updated_at trigger exists in production; the app layer owns
--     updated_at on UPDATE. Reproduced faithfully (NO trigger added here).
--   * HOD policy (b) decisions LOCKED: WITH CHECK restricts the resulting
--     status to {'draft','pending_approval'} (publish stays COMMAND/CHIEF
--     only); USING does NOT exclude 'published' rows — an HOD editing a
--     published dept silently reverts it (per Round-2 design), and can never
--     re-publish because the WITH CHECK forbids 'published'.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rota_department_status (
  id                       uuid        NOT NULL DEFAULT gen_random_uuid(),
  rota_id                  uuid        NOT NULL,
  department_id            uuid        NOT NULL,
  tenant_id                uuid        NOT NULL,
  vessel_id                uuid        NOT NULL,
  status                   text        NOT NULL DEFAULT 'draft'::text,
  has_unpublished_changes  boolean     NOT NULL DEFAULT false,
  submitted_by             uuid,
  submitted_at             timestamptz,
  last_published_by        uuid,
  last_published_at        timestamptz,
  last_rejection_note      text,
  last_rejected_by         uuid,
  last_rejected_at         timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rota_department_status_pkey PRIMARY KEY (id),
  CONSTRAINT rota_department_status_status_check
    CHECK (status = ANY (ARRAY['draft'::text, 'pending_approval'::text, 'published'::text])),
  CONSTRAINT rota_department_status_rota_id_department_id_key
    UNIQUE (rota_id, department_id),
  CONSTRAINT rota_department_status_rota_id_fkey
    FOREIGN KEY (rota_id) REFERENCES public.rotas(id) ON DELETE CASCADE,
  CONSTRAINT rota_department_status_department_id_fkey
    FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE RESTRICT,
  CONSTRAINT rota_department_status_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT rota_department_status_submitted_by_fkey
    FOREIGN KEY (submitted_by) REFERENCES auth.users(id),
  CONSTRAINT rota_department_status_last_published_by_fkey
    FOREIGN KEY (last_published_by) REFERENCES auth.users(id),
  CONSTRAINT rota_department_status_last_rejected_by_fkey
    FOREIGN KEY (last_rejected_by) REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_rota_dept_status_pending
  ON public.rota_department_status USING btree (tenant_id, status)
  WHERE (status = 'pending_approval'::text);
CREATE INDEX IF NOT EXISTS idx_rota_dept_status_rota
  ON public.rota_department_status USING btree (rota_id);
CREATE INDEX IF NOT EXISTS idx_rota_dept_status_tenant
  ON public.rota_department_status USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_rota_dept_status_vessel
  ON public.rota_department_status USING btree (vessel_id);

-- ── RLS: step-3 baseline ─────────────────────────────────────────────────────
ALTER TABLE public.rota_department_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rota_department_status_tenant_read" ON public.rota_department_status;
CREATE POLICY "rota_department_status_tenant_read" ON public.rota_department_status FOR SELECT
  USING (tenant_id IN (
    SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = auth.uid() AND tm.active = true));

DROP POLICY IF EXISTS "rota_department_status_command_chief_write" ON public.rota_department_status;
CREATE POLICY "rota_department_status_command_chief_write" ON public.rota_department_status FOR ALL
  USING (tenant_id IN (
    SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = auth.uid() AND tm.active = true
      AND tm.permission_tier = ANY (ARRAY['COMMAND'::text, 'CHIEF'::text])));

-- ── RLS: step-4 ADDITIVE HOD submit policy (b) ───────────────────────────────
DROP POLICY IF EXISTS "rota_department_status_hod_submit" ON public.rota_department_status;
CREATE POLICY "rota_department_status_hod_submit" ON public.rota_department_status FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.tenant_members tm
            WHERE tm.user_id = auth.uid() AND tm.active = true
              AND tm.permission_tier = 'HOD'
              AND tm.tenant_id     = rota_department_status.tenant_id
              AND tm.department_id = rota_department_status.department_id))
  WITH CHECK (
    status = ANY (ARRAY['draft'::text, 'pending_approval'::text])
    AND EXISTS (SELECT 1 FROM public.tenant_members tm
            WHERE tm.user_id = auth.uid() AND tm.active = true
              AND tm.permission_tier = 'HOD'
              AND tm.tenant_id     = rota_department_status.tenant_id
              AND tm.department_id = rota_department_status.department_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260518000006_create_rota_shift_templates.sql
--
-- WHAT: Creates public.rota_shift_templates — reusable shift patterns, either
--       vessel-scope (department_id NULL) or department-scope. Includes
--       constraints, indexes, step-3 baseline RLS, and the step-4 ADDITIVE HOD
--       own-department CRUD policy (c). Seed data lands in _007 (not here).
--
-- RECOVERY MIGRATION: schema is ALREADY LIVE. No-op on prod.
--
-- IDEMPOTENCY: CREATE TABLE IF NOT EXISTS; CREATE INDEX IF NOT EXISTS; ENABLE
--       RLS no-op if enabled; DROP POLICY IF EXISTS before CREATE POLICY.
--
-- AUDIT NOTES / QUIRKS:
--   * vessel_id NOT NULL, NO FK (live shape; reproduced as-is).
--   * department_id FK → departments(id) ON DELETE CASCADE (note: CASCADE here,
--     vs RESTRICT on the other rota tables — reproduced exactly as live).
--   * template_scope_matches CHECK enforces scope='vessel'⟺dept NULL and
--     scope='department'⟺dept NOT NULL — this guarantees HOD policy (c)'s join
--     is always well-formed.
--   * No updated_at trigger in prod; app layer owns updated_at (NOT added).
--   * HOD policy (c) decision LOCKED: HOD has full INSERT/UPDATE/DELETE on
--     scope='department' templates for THEIR OWN department only; no vessel-
--     scope, no other departments.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rota_shift_templates (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  vessel_id      uuid        NOT NULL,
  name           text        NOT NULL,
  kind           text        NOT NULL,
  scope          text        NOT NULL,
  department_id  uuid,
  body           jsonb       NOT NULL,
  is_default     boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rota_shift_templates_pkey PRIMARY KEY (id),
  CONSTRAINT rota_shift_templates_kind_check
    CHECK (kind = ANY (ARRAY['simple'::text, 'rotation'::text])),
  CONSTRAINT rota_shift_templates_scope_check
    CHECK (scope = ANY (ARRAY['vessel'::text, 'department'::text])),
  CONSTRAINT template_scope_matches
    CHECK (((scope = 'vessel'::text     AND department_id IS NULL)
         OR (scope = 'department'::text AND department_id IS NOT NULL))),
  CONSTRAINT rota_shift_templates_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT rota_shift_templates_department_id_fkey
    FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE CASCADE,
  CONSTRAINT rota_shift_templates_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_templates_scope_dept
  ON public.rota_shift_templates USING btree (tenant_id, scope, department_id);
CREATE INDEX IF NOT EXISTS idx_templates_tenant
  ON public.rota_shift_templates USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_templates_vessel
  ON public.rota_shift_templates USING btree (vessel_id);

-- ── RLS: step-3 baseline ─────────────────────────────────────────────────────
ALTER TABLE public.rota_shift_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rota_shift_templates_tenant_read" ON public.rota_shift_templates;
CREATE POLICY "rota_shift_templates_tenant_read" ON public.rota_shift_templates FOR SELECT
  USING (tenant_id IN (
    SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = auth.uid() AND tm.active = true));

DROP POLICY IF EXISTS "rota_shift_templates_command_chief_write" ON public.rota_shift_templates;
CREATE POLICY "rota_shift_templates_command_chief_write" ON public.rota_shift_templates FOR ALL
  USING (tenant_id IN (
    SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = auth.uid() AND tm.active = true
      AND tm.permission_tier = ANY (ARRAY['COMMAND'::text, 'CHIEF'::text])));

-- ── RLS: step-4 ADDITIVE HOD own-department policy (c) ───────────────────────
DROP POLICY IF EXISTS "rota_shift_templates_hod_own_dept" ON public.rota_shift_templates;
CREATE POLICY "rota_shift_templates_hod_own_dept" ON public.rota_shift_templates FOR ALL
  USING (
    scope = 'department'
    AND EXISTS (SELECT 1 FROM public.tenant_members tm
            WHERE tm.user_id = auth.uid() AND tm.active = true
              AND tm.permission_tier = 'HOD'
              AND tm.tenant_id     = rota_shift_templates.tenant_id
              AND tm.department_id = rota_shift_templates.department_id))
  WITH CHECK (
    scope = 'department'
    AND EXISTS (SELECT 1 FROM public.tenant_members tm
            WHERE tm.user_id = auth.uid() AND tm.active = true
              AND tm.permission_tier = 'HOD'
              AND tm.tenant_id     = rota_shift_templates.tenant_id
              AND tm.department_id = rota_shift_templates.department_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260518000008_create_rota_template_stars.sql
--
-- WHAT: Creates public.rota_template_stars — per-user "favourite" marks on
--       templates. Composite PK (user_id, template_id). Includes the index
--       and a single USER-SCOPED RLS policy (a user manages only their own
--       stars; not tier-based like the other rota tables).
--
-- RECOVERY MIGRATION: schema is ALREADY LIVE. No-op on prod.
--
-- IDEMPOTENCY: CREATE TABLE IF NOT EXISTS; CREATE INDEX IF NOT EXISTS; ENABLE
--       RLS no-op if enabled; DROP POLICY IF EXISTS before CREATE POLICY.
--
-- AUDIT NOTES / QUIRKS:
--   * PK is (user_id, template_id) — there is NO surrogate id column.
--   * All three FKs are ON DELETE CASCADE (user, template, tenant).
--   * RLS departs from the COMMAND/CHIEF pattern deliberately: stars are
--     personal, so the policy is user_id = auth.uid() (still tenant-bounded
--     for defence-in-depth). Same predicate on USING and WITH CHECK.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rota_template_stars (
  user_id      uuid        NOT NULL,
  template_id  uuid        NOT NULL,
  tenant_id    uuid        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rota_template_stars_pkey PRIMARY KEY (user_id, template_id),
  CONSTRAINT rota_template_stars_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT rota_template_stars_template_id_fkey
    FOREIGN KEY (template_id) REFERENCES public.rota_shift_templates(id) ON DELETE CASCADE,
  CONSTRAINT rota_template_stars_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_stars_user
  ON public.rota_template_stars USING btree (user_id, tenant_id);

-- ── RLS: user-scoped (own stars only) ────────────────────────────────────────
ALTER TABLE public.rota_template_stars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rota_template_stars_own" ON public.rota_template_stars;
CREATE POLICY "rota_template_stars_own" ON public.rota_template_stars FOR ALL
  USING (
    user_id = auth.uid()
    AND tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.active = true))
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.active = true));

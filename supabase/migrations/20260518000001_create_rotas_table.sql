-- ─────────────────────────────────────────────────────────────────────────────
-- 20260518000001_create_rotas_table.sql
--
-- WHAT: Creates public.rotas — the rota container (one standing "vessel" rota
--       per vessel + N "trip" rotas). Includes its constraints, indexes, and
--       the step-3 baseline RLS policies (tenant read / COMMAND-CHIEF write).
--
-- RECOVERY MIGRATION: This recreates schema that is ALREADY LIVE in production
--       (applied out-of-band in a prior session, never committed). On prod this
--       file is a no-op; on a fresh environment it reproduces the live shape.
--
-- IDEMPOTENCY: CREATE TABLE IF NOT EXISTS (skips wholesale on prod, incl. all
--       inline constraints); CREATE INDEX IF NOT EXISTS; ENABLE RLS is a no-op
--       if already enabled; DROP POLICY IF EXISTS before CREATE POLICY.
--
-- AUDIT NOTES / QUIRKS captured during introspection:
--   * vessel_id is NOT NULL but has NO FK to any vessels table (live shape;
--     reproduced as-is, not "fixed").
--   * Exclusion constraint `rota_one_vessel_per_tenant` keys on vessel_id ONLY
--     (despite its name) — one vessel-rota per vessel_id. Postgres auto-creates
--     its backing index; we do NOT create it separately. A functionally
--     identical plain index `idx_rotas_standing` also exists live and IS
--     created here explicitly.
--   * EXCLUDE USING btree (vessel_id WITH =) needs only btree (no btree_gist).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rotas (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  vessel_id   uuid        NOT NULL,
  owner_type  text        NOT NULL,
  trip_id     uuid,
  date_start  date        NOT NULL,
  date_end    date,
  name        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rotas_pkey PRIMARY KEY (id),
  CONSTRAINT rotas_owner_type_check
    CHECK (owner_type = ANY (ARRAY['trip'::text, 'vessel'::text])),
  CONSTRAINT rota_owner_matches_type
    CHECK (((owner_type = 'trip'::text AND trip_id IS NOT NULL AND date_end IS NOT NULL)
         OR (owner_type = 'vessel'::text AND trip_id IS NULL))),
  CONSTRAINT rota_trip_date_range_valid
    CHECK ((date_end IS NULL OR date_end >= date_start)),
  CONSTRAINT rotas_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT rotas_trip_id_fkey
    FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE,
  CONSTRAINT rotas_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id),
  CONSTRAINT rota_one_vessel_per_tenant
    EXCLUDE USING btree (vessel_id WITH =) WHERE (owner_type = 'vessel'::text)
);

CREATE INDEX IF NOT EXISTS idx_rotas_dates
  ON public.rotas USING btree (vessel_id, date_start, date_end);
CREATE INDEX IF NOT EXISTS idx_rotas_standing
  ON public.rotas USING btree (vessel_id) WHERE (owner_type = 'vessel'::text);
CREATE INDEX IF NOT EXISTS idx_rotas_tenant
  ON public.rotas USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_rotas_trip
  ON public.rotas USING btree (trip_id) WHERE (trip_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_rotas_vessel
  ON public.rotas USING btree (vessel_id);

-- ── RLS: step-3 baseline ─────────────────────────────────────────────────────
ALTER TABLE public.rotas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rotas_tenant_read" ON public.rotas;
CREATE POLICY "rotas_tenant_read" ON public.rotas FOR SELECT
  USING (tenant_id IN (
    SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = auth.uid() AND tm.active = true));

DROP POLICY IF EXISTS "rotas_command_chief_write" ON public.rotas;
CREATE POLICY "rotas_command_chief_write" ON public.rotas FOR ALL
  USING (tenant_id IN (
    SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = auth.uid() AND tm.active = true
      AND tm.permission_tier = ANY (ARRAY['COMMAND'::text, 'CHIEF'::text])));

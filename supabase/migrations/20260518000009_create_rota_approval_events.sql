-- ─────────────────────────────────────────────────────────────────────────────
-- 20260518000009_create_rota_approval_events.sql
--
-- WHAT: Creates public.rota_approval_events — append-only audit log of the
--       submit / approve / reject / publish_direct workflow. Includes
--       constraints, indexes, and append-only RLS (tenant read; insert only
--       your own event; NO update/delete policy → immutable).
--
-- RECOVERY MIGRATION: schema is ALREADY LIVE. No-op on prod.
--
-- IDEMPOTENCY: CREATE TABLE IF NOT EXISTS; CREATE INDEX IF NOT EXISTS; ENABLE
--       RLS no-op if enabled; DROP POLICY IF EXISTS before CREATE POLICY.
--
-- AUDIT NOTES / QUIRKS:
--   * vessel_id NOT NULL, NO FK (live shape; reproduced as-is).
--   * department_id FK → departments(id) ON DELETE RESTRICT.
--   * actor_tier CHECK = {COMMAND, CHIEF, HOD}; event_type CHECK =
--     {submitted, approved, rejected, published_direct}. The presence of HOD
--     here (a recognised actor) while live rota_shifts blocks HOD writes is
--     the gap the step-4 additive policies resolve.
--   * Append-only: a SELECT policy and an INSERT-own policy are created; NO
--     UPDATE or DELETE policy is created, so with RLS on (and not forced for
--     the table owner) ordinary roles cannot mutate or delete events.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rota_approval_events (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  rota_id        uuid        NOT NULL,
  department_id  uuid        NOT NULL,
  tenant_id      uuid        NOT NULL,
  vessel_id      uuid        NOT NULL,
  event_type     text        NOT NULL,
  actor_id       uuid        NOT NULL,
  actor_tier     text        NOT NULL,
  note           text,
  context        jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rota_approval_events_pkey PRIMARY KEY (id),
  CONSTRAINT rota_approval_events_event_type_check
    CHECK (event_type = ANY (ARRAY['submitted'::text, 'approved'::text,
                                   'rejected'::text, 'published_direct'::text])),
  CONSTRAINT rota_approval_events_actor_tier_check
    CHECK (actor_tier = ANY (ARRAY['COMMAND'::text, 'CHIEF'::text, 'HOD'::text])),
  CONSTRAINT rota_approval_events_rota_id_fkey
    FOREIGN KEY (rota_id) REFERENCES public.rotas(id) ON DELETE CASCADE,
  CONSTRAINT rota_approval_events_department_id_fkey
    FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE RESTRICT,
  CONSTRAINT rota_approval_events_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT rota_approval_events_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_approval_events_actor
  ON public.rota_approval_events USING btree (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_events_rota_dept
  ON public.rota_approval_events USING btree (rota_id, department_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_events_tenant
  ON public.rota_approval_events USING btree (tenant_id, created_at DESC);

-- ── RLS: append-only ─────────────────────────────────────────────────────────
ALTER TABLE public.rota_approval_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rota_approval_events_tenant_read" ON public.rota_approval_events;
CREATE POLICY "rota_approval_events_tenant_read" ON public.rota_approval_events FOR SELECT
  USING (tenant_id IN (
    SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = auth.uid() AND tm.active = true));

DROP POLICY IF EXISTS "rota_approval_events_insert_own" ON public.rota_approval_events;
CREATE POLICY "rota_approval_events_insert_own" ON public.rota_approval_events FOR INSERT
  WITH CHECK (
    actor_id = auth.uid()
    AND tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.active = true));

-- Deliberately NO UPDATE / DELETE policy → events are immutable.

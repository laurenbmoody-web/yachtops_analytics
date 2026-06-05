-- ─────────────────────────────────────────────────────────────────────────────
-- 20260605120000_create_review_items.sql
--
-- WHAT: Creates public.review_items — a generic per-tenant inbox of items that
--       need a human decision (accept / reject / accept-with-edits). v1 source
--       is the rota lifecycle (a HOD submission inserts a review_item assigned
--       to CHIEF/COMMAND); the table is kept source-agnostic so future modules
--       (HOR, jobs, others) can write into the same inbox.
--
-- NOT A RECOVERY MIGRATION: this is forward-going schema for an unbuilt
--       workstream — rota publish/review lifecycle, Phase 1 of 6 per the
--       2026-06-05 discovery → design session. The table does not exist
--       anywhere yet.
--
-- IDEMPOTENCY: CREATE TABLE IF NOT EXISTS; CREATE INDEX IF NOT EXISTS;
--       CREATE OR REPLACE FUNCTION; DROP TRIGGER / DROP POLICY IF EXISTS
--       before CREATE TRIGGER / CREATE POLICY; ENABLE RLS is a no-op if
--       already enabled. Safe to re-apply.
--
-- DESIGN NOTES:
--   * source_module is intentionally OPEN text in v1 — no CHECK enum. When a
--     second source module lands we add a CHECK constraint listing all known
--     sources. Documented here so future-us doesn't widen a constraint that
--     never existed.
--   * source_id is a uuid NOT NULL but carries NO foreign key — the table is
--     source-agnostic and uuids may point at rota_department_status.id today,
--     hor_*.id tomorrow, etc. Referential integrity for source linkage lives
--     at the application layer.
--   * assignee_department_id NULL semantic: tenant-wide. Used for COMMAND-only
--     items where no specific dept owns the review.
--   * RLS update predicate elevates COMMAND to act on any item in their tenant
--     regardless of assignee_tier or assignee_department_id — they are the
--     catch-all assignee for the maritime tier hierarchy. CHIEFs are scoped to
--     assignee_tier='CHIEF' AND (assignee_department_id IS NULL OR their own
--     department).
--   * Provenance fields (tenant_id, source_module, source_id, assignee_tier,
--     assignee_department_id, submitter_id, created_at) are immutable via a
--     BEFORE UPDATE trigger. The WITH CHECK on UPDATE re-asserts the assignee
--     predicate but cannot itself reference OLD, so column-level immutability
--     is enforced at the trigger level. Only status, decision_note,
--     decided_by, decided_at, updated_at are mutable.
--   * No DELETE policy — review_items are append-with-status-updates only.
--     Decisions are recorded by UPDATE to status + decision fields, never by
--     deletion. With RLS on and not forced for the table owner, ordinary
--     roles cannot delete rows.
--   * No updated_at automation trigger — the app layer owns updated_at on
--     UPDATE. Same Phase-0.5 hygiene pattern used by rota_department_status.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.review_items (
  id                       uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id                uuid        NOT NULL,
  source_module            text        NOT NULL,
  source_id                uuid        NOT NULL,
  source_context           jsonb,
  assignee_tier            text        NOT NULL,
  assignee_department_id   uuid,
  submitter_id             uuid        NOT NULL,
  status                   text        NOT NULL DEFAULT 'pending',
  decision_note            text,
  decided_by               uuid,
  decided_at               timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_items_pkey PRIMARY KEY (id),
  CONSTRAINT review_items_status_check
    CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text,
                               'rejected'::text, 'accepted_with_edits'::text])),
  CONSTRAINT review_items_assignee_tier_check
    CHECK (assignee_tier = ANY (ARRAY['CHIEF'::text, 'COMMAND'::text])),
  CONSTRAINT review_items_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT review_items_assignee_department_id_fkey
    FOREIGN KEY (assignee_department_id) REFERENCES public.departments(id) ON DELETE RESTRICT,
  CONSTRAINT review_items_submitter_id_fkey
    FOREIGN KEY (submitter_id) REFERENCES auth.users(id),
  CONSTRAINT review_items_decided_by_fkey
    FOREIGN KEY (decided_by) REFERENCES auth.users(id)
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
-- Primary inbox query — pending items in tenant. Mirrors the partial-index
-- pattern from rota_department_status' idx_rota_dept_status_pending.
CREATE INDEX IF NOT EXISTS idx_review_items_tenant_pending
  ON public.review_items USING btree (tenant_id, status)
  WHERE (status = 'pending'::text);

-- Assignee-filtered inbox — COMMAND inbox and per-dept CHIEF inbox both
-- index-friendly. Partial on pending; the historical query path (closed items)
-- is rarer and can scan.
CREATE INDEX IF NOT EXISTS idx_review_items_assignee_pending
  ON public.review_items USING btree (tenant_id, assignee_tier, assignee_department_id)
  WHERE (status = 'pending'::text);

-- "My submissions" history query — used by a submitter looking back at items
-- they've raised. Descending by created_at for recency-first ordering.
CREATE INDEX IF NOT EXISTS idx_review_items_submitter
  ON public.review_items USING btree (submitter_id, created_at DESC);

-- Source-side lookup — "does this rota_department_status row already have a
-- pending review_item?" Used by the rota submit writer to dedupe (Phase 2).
CREATE INDEX IF NOT EXISTS idx_review_items_source
  ON public.review_items USING btree (source_module, source_id);

-- ── Immutability trigger ─────────────────────────────────────────────────────
-- Postgres RLS WITH CHECK cannot reference OLD, so provenance immutability
-- (tenant_id, source_module, source_id, assignee_tier, assignee_department_id,
-- submitter_id, created_at) is enforced here. Mutable fields: status,
-- decision_note, decided_by, decided_at, updated_at.

CREATE OR REPLACE FUNCTION public.review_items_block_immutable_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'review_items.tenant_id is immutable';
  END IF;
  IF NEW.source_module IS DISTINCT FROM OLD.source_module THEN
    RAISE EXCEPTION 'review_items.source_module is immutable';
  END IF;
  IF NEW.source_id IS DISTINCT FROM OLD.source_id THEN
    RAISE EXCEPTION 'review_items.source_id is immutable';
  END IF;
  IF NEW.assignee_tier IS DISTINCT FROM OLD.assignee_tier THEN
    RAISE EXCEPTION 'review_items.assignee_tier is immutable';
  END IF;
  IF NEW.assignee_department_id IS DISTINCT FROM OLD.assignee_department_id THEN
    RAISE EXCEPTION 'review_items.assignee_department_id is immutable';
  END IF;
  IF NEW.submitter_id IS DISTINCT FROM OLD.submitter_id THEN
    RAISE EXCEPTION 'review_items.submitter_id is immutable';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'review_items.created_at is immutable';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS review_items_immutable_columns ON public.review_items;
CREATE TRIGGER review_items_immutable_columns
  BEFORE UPDATE ON public.review_items
  FOR EACH ROW
  EXECUTE FUNCTION public.review_items_block_immutable_columns();

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.review_items ENABLE ROW LEVEL SECURITY;

-- (1) Tenant read — every active tenant_member can see all review_items for
-- their tenant. Submitters see their own; assignees see their inbox; broad
-- read access is audit-friendly. Mirrors rota_department_status_tenant_read.
DROP POLICY IF EXISTS "review_items_tenant_read" ON public.review_items;
CREATE POLICY "review_items_tenant_read" ON public.review_items FOR SELECT
  USING (tenant_id IN (
    SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = auth.uid() AND tm.active = true));

-- (2) Tenant insert — any active tenant_member can insert items for their
-- tenant. No tier gate: HODs need to insert items (rota submissions) on their
-- own behalf, so the gate must permit non-COMMAND/CHIEF writers. Source-side
-- correctness (who is allowed to submit what) is the WRITER's responsibility
-- in Phase 2, not the RLS's.
DROP POLICY IF EXISTS "review_items_tenant_insert" ON public.review_items;
CREATE POLICY "review_items_tenant_insert" ON public.review_items FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = auth.uid() AND tm.active = true));

-- (3) Assignee update — only matching assignees can act on a row.
--   COMMAND in this tenant: act on ANY item (catch-all override).
--   CHIEF in this tenant: act on items where assignee_tier='CHIEF' AND
--     (assignee_department_id IS NULL OR matches the CHIEF's department).
--   All other tiers (HOD, CREW, etc.): no UPDATE access.
-- WITH CHECK repeats the same predicate so an UPDATE cannot move the row out
-- of the assignee's scope (mutation of assignee_tier / assignee_department_id
-- is independently blocked by the immutability trigger above, but the
-- WITH CHECK adds defense-in-depth for the assignee gate itself).
DROP POLICY IF EXISTS "review_items_assignee_update" ON public.review_items;
CREATE POLICY "review_items_assignee_update" ON public.review_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.active = true
        AND tm.tenant_id = review_items.tenant_id
        AND (
          tm.permission_tier = 'COMMAND'
          OR (
            tm.permission_tier = review_items.assignee_tier
            AND (
              review_items.assignee_department_id IS NULL
              OR tm.department_id = review_items.assignee_department_id
            )
          )
        )))
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.active = true
        AND tm.tenant_id = review_items.tenant_id
        AND (
          tm.permission_tier = 'COMMAND'
          OR (
            tm.permission_tier = review_items.assignee_tier
            AND (
              review_items.assignee_department_id IS NULL
              OR tm.department_id = review_items.assignee_department_id
            )
          )
        )));

-- Deliberately NO DELETE policy. review_items are append-with-status-updates
-- only; decisions are recorded by UPDATE, never by deletion. With RLS on
-- and not forced for the table owner, ordinary roles cannot delete rows.

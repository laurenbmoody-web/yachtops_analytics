-- ============================================================
-- supplier_return_tasks + delivery_inbox.supplier_profile_id
--
-- Part 1 of the Cargo-supplier return-routing sprint.
--
-- Two related changes, shipped atomically because the feature
-- needs both:
--   (A) NEW TABLE supplier_return_tasks — the shared object that
--       represents a return routed to a supplier's Cargo portal.
--       Crew create them; suppliers acknowledge / complete them.
--       Two RLS regimes: tenant_members on the crew side,
--       get_user_supplier_id() on the supplier side.
--   (B) NEW COLUMN delivery_inbox.supplier_profile_id — a real FK
--       to supplier_profiles so the routing decision can be made
--       from a concrete identifier instead of string matching.
--       Plus a best-effort backfill for existing rows.
--
-- IDEMPOTENT — every operation is guarded so re-runs are no-ops:
--   • Table:    CREATE TABLE IF NOT EXISTS.
--   • Indexes:  CREATE INDEX IF NOT EXISTS.
--   • Policies: DROP POLICY IF EXISTS then CREATE POLICY.
--   • Column:   ADD COLUMN IF NOT EXISTS.
--   • FK:       DO block probes pg_constraint first.
--   • Backfill: UPDATE-only on rows where supplier_profile_id IS NULL,
--               so it's a no-op on second run and on already-linked rows.
-- ============================================================


-- ─── (A) supplier_return_tasks ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.supplier_return_tasks (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id                 uuid NOT NULL REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
  tenant_id                   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_delivery_inbox_ids   uuid[] NOT NULL DEFAULT '{}'::uuid[],
  items                       jsonb NOT NULL DEFAULT '[]'::jsonb,
  status                      text NOT NULL DEFAULT 'sent'
                                CHECK (status IN ('sent','acknowledged','completed')),
  created_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  acknowledged_at             timestamptz,
  acknowledged_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at                timestamptz,
  supplier_note               text
);

COMMENT ON TABLE public.supplier_return_tasks IS
  'Return tasks routed from a vessel to a supplier''s Cargo portal. Created by crew when the originating delivery_inbox row''s supplier has a linked portal account. Tracked separately from delivery_inbox so the supplier-portal RLS regime (get_user_supplier_id) and the crew RLS regime (tenant_members) stay cleanly separated.';

-- Cascade choices:
--   supplier_id / tenant_id — CASCADE: if either parent is removed,
--     the tasks have no addressable participant; vanish with them.
--   created_by / acknowledged_by — SET NULL: keep task history even
--     if the user record is later removed.

-- Indexes — the two RLS predicates plus the typical status filter.
CREATE INDEX IF NOT EXISTS idx_supplier_return_tasks_supplier_status
  ON public.supplier_return_tasks (supplier_id, status);

CREATE INDEX IF NOT EXISTS idx_supplier_return_tasks_tenant_status
  ON public.supplier_return_tasks (tenant_id, status);

-- RLS — two regimes, both explicit. Enabled, NOT forced (matches
-- delivery_inbox posture).
ALTER TABLE public.supplier_return_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_return_tasks_supplier_read   ON public.supplier_return_tasks;
DROP POLICY IF EXISTS supplier_return_tasks_supplier_update ON public.supplier_return_tasks;
DROP POLICY IF EXISTS supplier_return_tasks_crew_read       ON public.supplier_return_tasks;
DROP POLICY IF EXISTS supplier_return_tasks_crew_insert     ON public.supplier_return_tasks;

-- Supplier side. get_user_supplier_id() is the existing function
-- (migration 20260419160000) that resolves auth.uid() -> supplier_id
-- via supplier_contacts. Suppliers can read + update their own
-- tasks; they cannot insert (crew creates) or delete (no DELETE policy).
CREATE POLICY supplier_return_tasks_supplier_read
  ON public.supplier_return_tasks
  FOR SELECT
  TO public
  USING (supplier_id = public.get_user_supplier_id());

CREATE POLICY supplier_return_tasks_supplier_update
  ON public.supplier_return_tasks
  FOR UPDATE
  TO public
  USING       (supplier_id = public.get_user_supplier_id())
  WITH CHECK  (supplier_id = public.get_user_supplier_id());

-- Crew side. Tenant members of the originating vessel see the task
-- (Part 4 surfaces the round-trip status) and can create new tasks
-- for their own tenant.
CREATE POLICY supplier_return_tasks_crew_read
  ON public.supplier_return_tasks
  FOR SELECT
  TO public
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY supplier_return_tasks_crew_insert
  ON public.supplier_return_tasks
  FOR INSERT
  TO public
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
    )
  );

-- (No DELETE policy — matches delivery_inbox. Completed tasks are
--  immutable history.)


-- ─── (B) delivery_inbox.supplier_profile_id ─────────────────
-- Nullable FK with ON DELETE SET NULL: a row whose supplier is
-- removed from supplier_profiles should not vanish — it just falls
-- back to the slip flow (Part 2 treats NULL as "not a Cargo user").
ALTER TABLE public.delivery_inbox
  ADD COLUMN IF NOT EXISTS supplier_profile_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'delivery_inbox_supplier_profile_id_fkey'
      AND conrelid = 'public.delivery_inbox'::regclass
  ) THEN
    ALTER TABLE public.delivery_inbox
      ADD CONSTRAINT delivery_inbox_supplier_profile_id_fkey
      FOREIGN KEY (supplier_profile_id)
      REFERENCES public.supplier_profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Partial index: only rows with a linked supplier are interesting to
-- the routing decision. Keeps the index small (most rows historically
-- have no link).
CREATE INDEX IF NOT EXISTS idx_delivery_inbox_supplier_profile_id
  ON public.delivery_inbox (supplier_profile_id)
  WHERE supplier_profile_id IS NOT NULL;


-- ─── Best-effort backfill ───────────────────────────────────
-- supplier_profiles has NO tenant_id (suppliers are cross-tenant
-- entities), so the match cannot be tenant-scoped. To avoid silently
-- picking the wrong supplier when two share a name:
--   Pass 1: exact email match (low collision risk; emails tend to
--           be unique per supplier).
--   Pass 2: exact normalized-name match, but ONLY where the
--           normalized name is unique across ALL supplier_profiles.
--           Ambiguous names stay NULL — best-effort by design.
-- Both passes only touch rows where supplier_profile_id IS NULL,
-- so they are individually idempotent and safe on re-run.
DO $$
DECLARE
  pre_null_count    int;
  post_email_count  int;
  post_name_count   int;
  matched_by_email  int;
  matched_by_name   int;
  still_null        int;
BEGIN
  SELECT count(*) INTO pre_null_count
    FROM public.delivery_inbox
    WHERE supplier_profile_id IS NULL;

  -- Pass 1: exact email match.
  UPDATE public.delivery_inbox di
  SET    supplier_profile_id = sp.id
  FROM   public.supplier_profiles sp
  WHERE  di.supplier_profile_id IS NULL
    AND  di.supplier_email IS NOT NULL
    AND  btrim(di.supplier_email) <> ''
    AND  sp.contact_email IS NOT NULL
    AND  btrim(sp.contact_email) <> ''
    AND  lower(btrim(di.supplier_email)) = lower(btrim(sp.contact_email));

  SELECT count(*) INTO post_email_count
    FROM public.delivery_inbox
    WHERE supplier_profile_id IS NULL;
  matched_by_email := pre_null_count - post_email_count;

  -- Pass 2: exact normalized-name match — only unambiguous names.
  -- HAVING count(*) = 1 guarantees exactly one row per name group, so
  -- the aggregate just routes that single id through. Postgres has no
  -- min() / max() aggregate for the uuid type, hence the text round-trip.
  UPDATE public.delivery_inbox di
  SET    supplier_profile_id = unambig.id
  FROM   (
           SELECT lower(btrim(name))    AS name_key,
                  min(id::text)::uuid   AS id
           FROM   public.supplier_profiles
           WHERE  name IS NOT NULL AND btrim(name) <> ''
           GROUP  BY lower(btrim(name))
           HAVING count(*) = 1
         ) unambig
  WHERE  di.supplier_profile_id IS NULL
    AND  di.supplier_name IS NOT NULL
    AND  btrim(di.supplier_name) <> ''
    AND  lower(btrim(di.supplier_name)) = unambig.name_key;

  SELECT count(*) INTO post_name_count
    FROM public.delivery_inbox
    WHERE supplier_profile_id IS NULL;
  matched_by_name := post_email_count - post_name_count;
  still_null      := post_name_count;

  RAISE NOTICE '[delivery_inbox.supplier_profile_id backfill] matched by email: %, matched by name: %, still NULL: %',
    matched_by_email, matched_by_name, still_null;
END $$;

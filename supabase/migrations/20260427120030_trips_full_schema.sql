-- Phase A1 / Step 2 — trips full schema migration
--
-- Background: the user spec assumed a stub trips table existed
-- (id bigint + created_at). Discovery confirmed it does NOT — every
-- previous reference is just provisioning_lists.trip_id as a plain
-- uuid (no FK), with the "trips table does not exist in Supabase yet"
-- caveat in 20260325110000_fix_provisioning_use_tenant_id.sql.
--
-- The IF EXISTS rename below is defensive: if a stub was created via
-- Supabase Studio outside the migrations stream, we move it aside as
-- trips_legacy_stub so the new schema can claim the canonical name.
-- If no stub exists (the expected case), the rename is a no-op.
--
-- Frontend stays on localStorage after this migration applies. Phase A2
-- moves data + flips the read path; this file ships the foundation only.
--
-- Patterns matched from the codebase:
--   - gen_random_uuid() PK default (stew_notes, recent)
--   - tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
--   - is_tenant_member(tenant_id) RLS predicate (single-arg form)
--   - is_deleted / deleted_at / deleted_by_user_id soft-delete trio
--   - handle_<table>_updated_at trigger function naming
--
-- Architectural notes:
--   - Active trip is computed deterministically from start_date / end_date
--     (CURRENT_DATE BETWEEN start AND end). No is_active flag stored.
--     The (tenant_id, start_date, end_date) composite + the partial active
--     index below cover the common queries: "active trip for tenant",
--     "trips for tenant ordered by start", "trip by legacy id".
--   - legacy_local_id is the migration safety net so Phase A2's RPC can
--     dedupe re-runs. Drop in a follow-up migration once production has
--     been stable for ~30 days. Don't drop in this file.

-- ─── Defensive rename of any pre-existing stub ──────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'trips'
  ) THEN
    -- A stub may have leaked in via Supabase Studio. Move it aside so the
    -- canonical schema below can claim 'trips'. The legacy stub is
    -- preserved for inspection; drop it manually once verified.
    EXECUTE 'ALTER TABLE public.trips RENAME TO trips_legacy_stub';
  END IF;
END
$$;

-- ─── trips ──────────────────────────────────────────────────────────────────

CREATE TABLE public.trips (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid          NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Core fields. trip_type CHECK uses the existing frontend enum strings
  -- (TripType in src/pages/trips-management-dashboard/utils/tripStorage.js)
  -- so Phase A2's data migration is a 1:1 copy with no value translation.
  name                 text          NOT NULL,
  trip_type            text          NOT NULL
                                     CHECK (trip_type IN ('Owner', 'Charter', 'Friends/Family', 'Other')),
  start_date           date          NOT NULL,
  end_date             date          NOT NULL,
  itinerary_summary    text,
  notes                text,

  -- Audit columns. created_by intentionally nullable — Phase A2 rows
  -- migrated from localStorage may not have a creator on record.
  created_by           uuid          REFERENCES auth.users(id),
  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now(),

  -- Soft-delete trio. Same shape as stew_notes_soft_delete.
  is_deleted           boolean       NOT NULL DEFAULT false,
  deleted_at           timestamptz,
  deleted_by_user_id   uuid          REFERENCES auth.users(id),

  -- Migration safety net — UNIQUE so the RPC's idempotency check is
  -- index-backed. NULL allowed for trips created server-side that never
  -- existed in localStorage (post-A2 native creates).
  legacy_local_id      text          UNIQUE,

  CONSTRAINT trips_dates_ordered CHECK (end_date >= start_date)
);

-- ─── Indexes ────────────────────────────────────────────────────────────────

-- Tenant-scoped reads ("all trips for this vessel") — every list query.
CREATE INDEX idx_trips_tenant_id
  ON public.trips(tenant_id)
  WHERE is_deleted = false;

-- Active-trip query: WHERE tenant_id = $1 AND CURRENT_DATE BETWEEN start_date AND end_date.
-- The (tenant_id, start_date, end_date) composite supports this efficiently;
-- the partial WHERE is_deleted=false matches the frontend's default filter.
CREATE INDEX idx_trips_active_range
  ON public.trips(tenant_id, start_date, end_date)
  WHERE is_deleted = false;

-- Idempotency lookup for the migrate_localstorage_trip RPC. Single-row
-- equality on legacy_local_id; the UNIQUE constraint already creates the
-- underlying index so this is purely informational — Postgres won't make
-- a duplicate.
-- (No explicit CREATE INDEX needed; UNIQUE provides idx_trips_legacy_local_id.)

-- ─── updated_at trigger ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_trips_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_trips_updated_at ON public.trips;
CREATE TRIGGER set_trips_updated_at
  BEFORE UPDATE ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_trips_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

-- Single FOR ALL policy mirrors the stew_notes pattern (the simplest one
-- the codebase has shipped). Tenant-isolated via the existing
-- is_tenant_member SECURITY DEFINER helper to avoid recursion through
-- tenant_members RLS.
CREATE POLICY "tenant_members_manage_trips"
  ON public.trips FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

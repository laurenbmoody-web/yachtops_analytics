-- ─────────────────────────────────────────────────────────────────────────────
-- 20260718140000_laundry_cases.sql
--
-- Cases / containers for laundry: a named bag or case ("Cabin 3 — resort wear",
-- "Ski trip — hard case 2") that holds laundry items so crew can pack, send and
-- receive them as one unit. Each case carries its own QR label; scanning it
-- shows everything packed inside. A simple lifecycle status (open → packed →
-- sent → received → closed) records where the case is; the detailed per-hand-off
-- custody log lands in a later change.
--
-- Membership is a single FK on laundry_items (case_id) — mirrors how trip_id /
-- area_location_id already attach an item to a parent. ON DELETE SET NULL so
-- deleting a case never deletes the garments in it.
--
-- RLS: any active member of the vessel may manage its cases (is_tenant_member,
-- SECURITY DEFINER — recursion-safe), matching laundry_items.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.laundry_cases (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name             text NOT NULL,
  destination      text,                                 -- e.g. shore laundry, tender, storage
  status           text NOT NULL DEFAULT 'open',         -- open | packed | sent | received | closed
  notes            text,
  created_by       uuid REFERENCES auth.users(id),
  created_by_name  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz
);

CREATE INDEX IF NOT EXISTS laundry_cases_tenant_status_idx ON public.laundry_cases (tenant_id, status);

ALTER TABLE public.laundry_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_members_manage_laundry_cases" ON public.laundry_cases;
CREATE POLICY "tenant_members_manage_laundry_cases"
  ON public.laundry_cases FOR ALL TO authenticated
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

-- Attach items to a case. SET NULL so a deleted case unpacks its items, never
-- deletes them.
ALTER TABLE public.laundry_items
  ADD COLUMN IF NOT EXISTS case_id uuid REFERENCES public.laundry_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS laundry_items_case_idx ON public.laundry_items (case_id);

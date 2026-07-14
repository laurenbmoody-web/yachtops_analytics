-- ─────────────────────────────────────────────────────────────────────────────
-- 20260714120000_laundry_items.sql
--
-- Move laundry off localStorage onto a shared, vessel-scoped table so the whole
-- crew (and the laundry master) work from the same list. Mirrors the previous
-- localStorage item shape: owner (guest/crew/unknown), area/cabin, colour,
-- laundry number, photo (compressed base64 for now), description, priority,
-- status, tags, notes. `archived_at` replaces the old client "reset day" flag —
-- set on delivered items to drop them from the Today view.
--
-- RLS: any active member of the vessel may manage its laundry (is_tenant_member,
-- SECURITY DEFINER — recursion-safe).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.laundry_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  owner_type          text NOT NULL DEFAULT 'unknown',   -- guest | crew | unknown
  owner_name          text,
  owner_display_name  text,
  owner_guest_id      uuid,
  owner_crew_user_id  uuid,
  area                text,
  area_location_id    uuid,
  colour              text,
  laundry_number      text,
  photo               text,                              -- compressed base64 data URL
  description         text,
  priority            text NOT NULL DEFAULT 'Normal',    -- Normal | Urgent
  status              text NOT NULL DEFAULT 'InProgress',-- InProgress | ReadyToDeliver | Delivered
  tags                jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes               text,
  trip_id             uuid,
  created_by          uuid REFERENCES auth.users(id),
  created_by_name     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  delivered_at        timestamptz,
  archived_at         timestamptz
);

CREATE INDEX IF NOT EXISTS laundry_items_tenant_status_idx    ON public.laundry_items (tenant_id, status);
CREATE INDEX IF NOT EXISTS laundry_items_tenant_delivered_idx ON public.laundry_items (tenant_id, delivered_at);

ALTER TABLE public.laundry_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_members_manage_laundry" ON public.laundry_items;
CREATE POLICY "tenant_members_manage_laundry"
  ON public.laundry_items FOR ALL TO authenticated
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

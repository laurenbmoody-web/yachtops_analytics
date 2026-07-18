-- ─────────────────────────────────────────────────────────────────────────────
-- 20260718160000_laundry_wardrobes.sql
--
-- Wardrobes: the permanent HOME a garment lives in on board (the owner's
-- wardrobe, a cabin's drawers). Distinct from a case, which is transient — where
-- an item currently is when it's travelling. An item carries both:
--   wardrobe_id → its home (persists)         case_id → where it is now (travel)
-- "Pack" sets case_id; "unpack" clears it and the item is back in its wardrobe.
--
-- Membership is a single FK on laundry_items (wardrobe_id), mirroring case_id.
-- ON DELETE SET NULL so removing a wardrobe never deletes the garments in it.
--
-- RLS: any active member of the vessel may manage its wardrobes (is_tenant_member).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.laundry_wardrobes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name             text NOT NULL,
  location         text,                                 -- e.g. Owner's cabin, Master dressing room
  scope            text NOT NULL DEFAULT 'owner',        -- owner | charter | crew (which world it belongs to)
  notes            text,
  created_by       uuid REFERENCES auth.users(id),
  created_by_name  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz
);

CREATE INDEX IF NOT EXISTS laundry_wardrobes_tenant_idx ON public.laundry_wardrobes (tenant_id, scope);

ALTER TABLE public.laundry_wardrobes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_members_manage_laundry_wardrobes" ON public.laundry_wardrobes;
CREATE POLICY "tenant_members_manage_laundry_wardrobes"
  ON public.laundry_wardrobes FOR ALL TO authenticated
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

ALTER TABLE public.laundry_items
  ADD COLUMN IF NOT EXISTS wardrobe_id uuid REFERENCES public.laundry_wardrobes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS laundry_items_wardrobe_idx ON public.laundry_items (wardrobe_id);

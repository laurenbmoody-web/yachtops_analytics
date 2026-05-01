-- Trip itinerary activities — Phase A3.7a
-- New first-class concept; doesn't migrate from any localStorage source.
-- Attached to a trip_itinerary_days row via day_id; cascade-deletes when
-- the parent day is hard-deleted (soft-delete on day leaves activities
-- intact but they hide via the is_deleted filter on the parent in reads).

CREATE TABLE IF NOT EXISTS public.trip_itinerary_activities (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  day_id              UUID NOT NULL REFERENCES public.trip_itinerary_days(id) ON DELETE CASCADE,
  start_time          TIME NULL,
  title               TEXT NOT NULL,
  description         TEXT NULL,
  location            TEXT NULL,
  linked_guest_ids    UUID[] DEFAULT '{}' NOT NULL,
  sort_order          INTEGER DEFAULT 0 NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_by          UUID NULL REFERENCES auth.users(id),
  is_deleted          BOOLEAN DEFAULT FALSE NOT NULL,
  deleted_at          TIMESTAMPTZ NULL,
  deleted_by_user_id  UUID NULL REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_itinerary_activities_day
  ON public.trip_itinerary_activities (day_id, start_time, sort_order)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_itinerary_activities_tenant
  ON public.trip_itinerary_activities (tenant_id)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_itinerary_activities_linked_guests
  ON public.trip_itinerary_activities
  USING GIN (linked_guest_ids);

ALTER TABLE public.trip_itinerary_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_members_manage_itinerary_activities" ON public.trip_itinerary_activities;
CREATE POLICY "tenant_members_manage_itinerary_activities"
  ON public.trip_itinerary_activities FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

CREATE OR REPLACE FUNCTION public.handle_itinerary_activities_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS handle_itinerary_activities_updated_at ON public.trip_itinerary_activities;
CREATE TRIGGER handle_itinerary_activities_updated_at
  BEFORE UPDATE ON public.trip_itinerary_activities
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_itinerary_activities_updated_at();

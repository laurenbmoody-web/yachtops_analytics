-- Trip itinerary days — Phase A3.7a
-- Migrates trip.itineraryDays embedded array into a first-class table.
-- stop_type is nullable: the overview-tab modal doesn't ask for it, so
-- writes from there land NULL. Timeline modal sets it to one of the
-- three constrained values.

CREATE TABLE IF NOT EXISTS public.trip_itinerary_days (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  trip_id             UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  event_date          DATE NOT NULL,
  location            TEXT NOT NULL,
  stop_type           TEXT NULL CHECK (stop_type IS NULL OR stop_type IN ('Dock', 'Anchor', 'Underway')),
  stop_detail         TEXT NULL,
  notes               TEXT NULL,
  aboard_guest_ids    UUID[] DEFAULT '{}' NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_by          UUID NULL REFERENCES auth.users(id),
  is_deleted          BOOLEAN DEFAULT FALSE NOT NULL,
  deleted_at          TIMESTAMPTZ NULL,
  deleted_by_user_id  UUID NULL REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_itinerary_days_trip
  ON public.trip_itinerary_days (trip_id, event_date)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_itinerary_days_tenant
  ON public.trip_itinerary_days (tenant_id)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_itinerary_days_aboard_guests
  ON public.trip_itinerary_days
  USING GIN (aboard_guest_ids);

ALTER TABLE public.trip_itinerary_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_members_manage_itinerary_days" ON public.trip_itinerary_days;
CREATE POLICY "tenant_members_manage_itinerary_days"
  ON public.trip_itinerary_days FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

CREATE OR REPLACE FUNCTION public.handle_itinerary_days_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS handle_itinerary_days_updated_at ON public.trip_itinerary_days;
CREATE TRIGGER handle_itinerary_days_updated_at
  BEFORE UPDATE ON public.trip_itinerary_days
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_itinerary_days_updated_at();

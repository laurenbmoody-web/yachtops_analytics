-- Phase A1 / Step 2 — trip_guests join table
--
-- Many-to-many between trips and guests with per-row state. Composite PK
-- (trip_id, guest_id) gives idempotent inserts via ON CONFLICT and
-- doubles as the lookup index for "guests on this trip".
--
-- is_active_on_trip is per-trip — the existing guests.is_active_on_trip
-- column is the global "currently on board" flag and stays as-is. The
-- join-table flag answers "was this guest part of trip X?" without
-- conflating with "is this guest currently active right now?".
--
-- RLS resolves tenant via the parent trip — keeps the policy short and
-- means any future change to trips.tenant_id semantics propagates here
-- without separate maintenance.

CREATE TABLE public.trip_guests (
  trip_id            uuid        NOT NULL REFERENCES public.trips(id)  ON DELETE CASCADE,
  guest_id           uuid        NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  is_active_on_trip  boolean     NOT NULL DEFAULT true,
  added_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, guest_id)
);

-- Reverse lookup: "all trips this guest has been on". The PK indexes
-- (trip_id, guest_id) so guest-first queries need their own index.
CREATE INDEX idx_trip_guests_guest_id ON public.trip_guests(guest_id);

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.trip_guests ENABLE ROW LEVEL SECURITY;

-- Tenant resolution via parent trip — same pattern provisioning_items uses
-- to resolve tenant via its parent provisioning_lists.
CREATE POLICY "tenant_members_manage_trip_guests"
  ON public.trip_guests FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = trip_guests.trip_id
        AND public.is_tenant_member(t.tenant_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = trip_guests.trip_id
        AND public.is_tenant_member(t.tenant_id)
    )
  );

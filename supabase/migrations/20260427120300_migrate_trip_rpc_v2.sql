-- Migration: migrate_localstorage_trip RPC v2 — fix early-return bug
--
-- Background:
--   The v1 RPC (20260427120200) returned early when a trip with the given
--   legacy_local_id already existed, skipping the guest-linking block
--   entirely. This meant any trip whose first migration call landed the
--   trip row but failed to link guests (e.g. p_guest_ids was [] on the
--   first call, or partial migration occurred) stayed broken forever —
--   subsequent migration runs hit the early-return and never re-tried
--   guest linking.
--
--   In production this manifested as trips migrated with empty
--   trip_guests arrays. We patched the existing affected rows with raw
--   SQL; this migration fixes the function so future runs handle the
--   recovery path correctly.
--
-- Fix:
--   Restructure so the guest-linking block runs in BOTH the
--   "fresh insert" and "found existing trip" paths. ON CONFLICT
--   (trip_id, guest_id) DO NOTHING — already in v1 — keeps re-runs
--   idempotent at the trip_guests level.
--
-- Compatibility:
--   Same signature as v1, so callers (the Phase A2 migration runner +
--   the dev console __cargoMigrateTrips global) need no changes. The
--   GRANT EXECUTE is re-issued defensively even though signature didn't
--   change — harmless.

CREATE OR REPLACE FUNCTION public.migrate_localstorage_trip(
  p_legacy_id          text,
  p_name               text,
  p_trip_type          text,
  p_start_date         date,
  p_end_date           date,
  p_itinerary_summary  text,
  p_guest_ids          uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   uuid;
  v_tenant_id uuid;
  v_trip_id   uuid;
  v_guest_id  uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  -- Resolve the caller's active tenant.
  SELECT tm.tenant_id
    INTO v_tenant_id
    FROM public.tenant_members tm
   WHERE tm.user_id = v_user_id
     AND tm.active IS NOT FALSE
   LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'no active tenant membership';
  END IF;

  -- Idempotency: try to find an existing trip for this legacy_id.
  -- Unlike v1, we DO NOT return early — we fall through to the
  -- guest-linking block to recover from partial migrations where the
  -- trip row exists but guest links are missing.
  SELECT id
    INTO v_trip_id
    FROM public.trips
   WHERE legacy_local_id = p_legacy_id
     AND tenant_id       = v_tenant_id
   LIMIT 1;

  -- Insert the trip row only if it doesn't exist yet.
  IF v_trip_id IS NULL THEN
    INSERT INTO public.trips (
      tenant_id, name, trip_type, start_date, end_date,
      itinerary_summary, created_by, legacy_local_id
    )
    VALUES (
      v_tenant_id, p_name, p_trip_type, p_start_date, p_end_date,
      p_itinerary_summary, v_user_id, p_legacy_id
    )
    RETURNING id INTO v_trip_id;
  END IF;

  -- Link guests. Always runs — fresh inserts and idempotent re-runs
  -- both reach this block. Cross-tenant guest IDs are silently filtered
  -- via the WHERE clause (g.tenant_id = v_tenant_id). ON CONFLICT keeps
  -- re-linking a no-op for guests already linked to this trip.
  IF p_guest_ids IS NOT NULL AND array_length(p_guest_ids, 1) > 0 THEN
    FOREACH v_guest_id IN ARRAY p_guest_ids LOOP
      INSERT INTO public.trip_guests (trip_id, guest_id, is_active_on_trip)
      SELECT v_trip_id, g.id, true
        FROM public.guests g
       WHERE g.id        = v_guest_id
         AND g.tenant_id = v_tenant_id
      ON CONFLICT (trip_id, guest_id) DO NOTHING;
    END LOOP;
  END IF;

  RETURN v_trip_id;
END;
$$;

-- Re-grant execute. Same signature as v1, so this is defensive — if a
-- future v3 changes the signature, the explicit re-grant pattern is
-- already established.
REVOKE ALL ON FUNCTION public.migrate_localstorage_trip(
  text, text, text, date, date, text, uuid[]
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.migrate_localstorage_trip(
  text, text, text, date, date, text, uuid[]
) TO authenticated;

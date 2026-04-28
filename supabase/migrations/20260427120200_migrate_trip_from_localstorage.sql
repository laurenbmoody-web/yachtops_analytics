-- Phase A1 / Step 2 — migrate_localstorage_trip RPC
--
-- Single-transaction insert of one localStorage trip + its guests.
-- Phase A2 calls this from the frontend per-trip during the data
-- migration sweep. SECURITY DEFINER so the function can resolve tenant
-- from the caller's tenant_members membership and bypass RLS for the
-- coordinated insert; the function still enforces tenant isolation
-- explicitly on every write.
--
-- Idempotency: the legacy_local_id UNIQUE column on trips lets us
-- check-and-return without a SELECT-INSERT race. Re-running the RPC
-- with the same p_legacy_id always returns the same trip uuid.
--
-- p_guest_ids is a UUID[] of guest rows already in Supabase. The
-- frontend resolves localStorage guest references → Supabase guest
-- uuids before calling this RPC. The RPC trusts the caller on guest
-- membership but verifies each guest's tenant matches the trip's
-- tenant — silently skips any cross-tenant id (defense in depth).

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

  -- Resolve the caller's active tenant. A user can technically be a
  -- member of multiple tenants, but the migration is run against the
  -- single active membership — same scoping the rest of the app uses.
  SELECT tm.tenant_id
    INTO v_tenant_id
    FROM public.tenant_members tm
   WHERE tm.user_id = v_user_id
     AND tm.active IS NOT FALSE
   LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'no active tenant membership';
  END IF;

  -- Idempotency: if this legacy_id has already been migrated for this
  -- tenant, return the existing trip id without writing. The UNIQUE
  -- constraint on legacy_local_id makes this a single-index lookup.
  SELECT id
    INTO v_trip_id
    FROM public.trips
   WHERE legacy_local_id = p_legacy_id
     AND tenant_id       = v_tenant_id
   LIMIT 1;

  IF v_trip_id IS NOT NULL THEN
    RETURN v_trip_id;
  END IF;

  -- Fresh insert. trip_type validation is enforced by the table CHECK
  -- constraint; the function passes the raw value through so the error
  -- surfaces with the constraint name if a bad value sneaks in.
  INSERT INTO public.trips (
    tenant_id, name, trip_type, start_date, end_date,
    itinerary_summary, created_by, legacy_local_id
  )
  VALUES (
    v_tenant_id, p_name, p_trip_type, p_start_date, p_end_date,
    p_itinerary_summary, v_user_id, p_legacy_id
  )
  RETURNING id INTO v_trip_id;

  -- Link guests. Cross-tenant guest IDs are silently skipped — the
  -- existence + tenant check in the WHERE clause filters them out
  -- before the INSERT. is_active_on_trip defaults to true; the
  -- frontend can flip it later if a guest was on the trip but isn't
  -- on board right now.
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

-- Tighten EXECUTE — only authenticated users; no anon access.
REVOKE ALL ON FUNCTION public.migrate_localstorage_trip(
  text, text, text, date, date, text, uuid[]
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.migrate_localstorage_trip(
  text, text, text, date, date, text, uuid[]
) TO authenticated;

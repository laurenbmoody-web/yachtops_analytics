-- ─────────────────────────────────────────────────────────────────────────────
-- 20260605130000_rota_lifecycle_writer_helpers.sql
--
-- WHAT: Shared infrastructure used by the four rota-lifecycle writers
--       (submit / approve / reject / publish_direct, Phase 2 of 6). Two
--       functions:
--         * take_rota_shift_snapshot(rota, dept, taken_by) → snapshot id
--           Reads all rota_shifts for the (rota, dept) tuple, computes
--           date range + count, writes an immutable rota_shift_snapshots
--           row with the shifts as a jsonb array. Returns the new id.
--         * active_tenant_member_tier(tenant) → text
--           Looks up auth.uid()'s permission_tier in the given tenant
--           (active members only). Available to writers that just need
--           the tier (e.g. for actor_tier on event rows). The writers
--           themselves currently do a combined tier+dept lookup inline
--           because they need both in one query — this helper is for
--           future code paths and inbox-side queries.
--
-- NOT A RECOVERY MIGRATION: forward-going schema for the rota
--       publish/review lifecycle build, Phase 2 of 6 per the 2026-06-05
--       design session.
--
-- WHY SECURITY DEFINER: snapshots must succeed regardless of which
--       writer triggered the call; the tier lookup must work even if
--       tenant_members RLS is restrictive about reading sibling rows.
--       Both functions are tightly scoped — they expose no surfaces a
--       client could abuse beyond their declared inputs.
--
-- IDEMPOTENCY: CREATE OR REPLACE FUNCTION for both. Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.take_rota_shift_snapshot(
  p_rota_id        uuid,
  p_department_id  uuid,
  p_taken_by       uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tenant_id    uuid;
  v_vessel_id    uuid;
  v_shift_data   jsonb;
  v_date_start   date;
  v_date_end     date;
  v_shift_count  integer;
  v_snapshot_id  uuid;
BEGIN
  SELECT r.tenant_id, r.vessel_id
    INTO v_tenant_id, v_vessel_id
  FROM public.rotas r
  WHERE r.id = p_rota_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Rota not found.' USING ERRCODE = 'P0002';
  END IF;

  -- rota_shifts has no direct department_id; dept linkage runs via
  -- member_id → tenant_members.id (.department_id). Collect the dept's
  -- shifts via the member subquery, aggregate to jsonb, and capture
  -- min/max/count in the same scan.
  SELECT
    COALESCE(jsonb_agg(to_jsonb(s.*) ORDER BY s.shift_date, s.start_time), '[]'::jsonb),
    min(s.shift_date),
    max(s.shift_date),
    count(*)
  INTO v_shift_data, v_date_start, v_date_end, v_shift_count
  FROM public.rota_shifts s
  WHERE s.rota_id = p_rota_id
    AND s.member_id IN (
      SELECT tm.id
      FROM public.tenant_members tm
      WHERE tm.tenant_id = v_tenant_id
        AND tm.department_id = p_department_id
    );

  IF v_shift_count = 0 THEN
    RAISE EXCEPTION 'No shifts to snapshot for this (rota, dept) pair.'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.rota_shift_snapshots (
    rota_id, department_id, tenant_id, vessel_id,
    snapshot_taken_at, snapshot_taken_by,
    shift_data, date_start, date_end, shift_count
  ) VALUES (
    p_rota_id, p_department_id, v_tenant_id, v_vessel_id,
    now(), p_taken_by,
    v_shift_data, v_date_start, v_date_end, v_shift_count
  )
  RETURNING id INTO v_snapshot_id;

  RETURN v_snapshot_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.take_rota_shift_snapshot(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.active_tenant_member_tier(
  p_tenant_id uuid
)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT tm.permission_tier
  FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid()
    AND tm.tenant_id = p_tenant_id
    AND tm.active = true
  LIMIT 1;
$function$;

GRANT EXECUTE ON FUNCTION public.active_tenant_member_tier(uuid) TO authenticated;

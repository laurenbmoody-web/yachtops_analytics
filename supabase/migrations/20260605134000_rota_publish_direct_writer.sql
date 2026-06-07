-- ─────────────────────────────────────────────────────────────────────────────
-- 20260605134000_rota_publish_direct_writer.sql
--
-- WHAT: publish_rota_department_direct(p_rota_id, p_department_id, p_note)
--       — RPC writer for the CHIEF (own dept) / COMMAND (any dept)
--       "publish directly" action. The fix-it-and-ship affordance that
--       skips submitted → approved.
--
--       Atomically:
--         1. Validates caller is either:
--              - CHIEF whose department_id = p_department_id, OR
--              - COMMAND (any dept).
--            HOD cannot publish-direct (would also fail Phase 1's
--            rota_department_status WITH CHECK clamp on HOD, which
--            forbids result='published').
--         2. Confirms rota_department_status.status='draft' STRICTLY.
--            Specifically rejects 'pending_approval' with a directive
--            message: "Use approve_rota_department for a submitted
--            dept; publish_direct is for draft-to-published only."
--         3. Takes a snapshot via take_rota_shift_snapshot(...).
--         4. Flips every draft rota_shift in the dept to 'published'.
--         5. Flips rota_department_status → 'published', stamps
--            last_published_by / last_published_at, clears
--            has_unpublished_changes, updated_at = now().
--         6. Writes a 'published_direct' rota_approval_events row.
--
--       NO review_items row involved — there was no submission, so no
--       inbox entry to update.
--
-- Phase 2 of 6 — rota publish/review lifecycle.
--
-- WHY SECURITY DEFINER: atomic multi-table writes across
--       rota_department_status / rota_shifts / rota_approval_events /
--       rota_shift_snapshots. See _131000 header.
--
-- IDEMPOTENCY: CREATE OR REPLACE FUNCTION. Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.publish_rota_department_direct(
  p_rota_id        uuid,
  p_department_id  uuid,
  p_note           text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tenant_id        uuid;
  v_vessel_id        uuid;
  v_dept_status_id   uuid;
  v_current_status   text;
  v_tier             text;
  v_member_dept_id   uuid;
  v_snapshot_id      uuid;
BEGIN
  -- (1) Resolve rota.
  SELECT r.tenant_id, r.vessel_id
    INTO v_tenant_id, v_vessel_id
  FROM public.rotas r
  WHERE r.id = p_rota_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Rota not found.' USING ERRCODE = 'P0002';
  END IF;

  -- (2) Validate caller is CHIEF (matching dept) or COMMAND (any dept).
  SELECT tm.permission_tier, tm.department_id
    INTO v_tier, v_member_dept_id
  FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid()
    AND tm.tenant_id = v_tenant_id
    AND tm.active = true
  LIMIT 1;

  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'You are not an active member of this tenant.';
  END IF;

  IF v_tier = 'COMMAND' THEN
    NULL;  -- cross-dept publish, ok
  ELSIF v_tier = 'CHIEF' AND v_member_dept_id = p_department_id THEN
    NULL;  -- own-dept publish, ok
  ELSE
    RAISE EXCEPTION 'Only COMMAND or the dept CHIEF can publish-direct.';
  END IF;

  -- (3) Look up dept status; must be STRICTLY draft.
  SELECT rds.id, rds.status
    INTO v_dept_status_id, v_current_status
  FROM public.rota_department_status rds
  WHERE rds.rota_id = p_rota_id
    AND rds.department_id = p_department_id;

  IF v_dept_status_id IS NULL THEN
    RAISE EXCEPTION 'No rota_department_status row for this (rota, department).'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_current_status = 'pending_approval' THEN
    RAISE EXCEPTION 'Use approve_rota_department for a submitted dept; publish_direct is for draft-to-published only.';
  END IF;

  IF v_current_status <> 'draft' THEN
    RAISE EXCEPTION 'Cannot publish-direct: department is in % state, expected draft.',
      v_current_status;
  END IF;

  -- (4) Snapshot.
  v_snapshot_id := public.take_rota_shift_snapshot(p_rota_id, p_department_id, auth.uid());

  -- (5) Publish all the dept's draft shifts.
  UPDATE public.rota_shifts
    SET status = 'published'
  WHERE rota_id = p_rota_id
    AND status = 'draft'
    AND member_id IN (
      SELECT tm.id FROM public.tenant_members tm
      WHERE tm.tenant_id = v_tenant_id
        AND tm.department_id = p_department_id
    );

  -- (6) Flip dept status.
  UPDATE public.rota_department_status
    SET status                  = 'published',
        last_published_by       = auth.uid(),
        last_published_at       = now(),
        has_unpublished_changes = false,
        updated_at              = now()
  WHERE id = v_dept_status_id;

  -- (7) Audit event. actor_tier is the caller's actual tier
  -- (CHIEF or COMMAND) for the historical record.
  INSERT INTO public.rota_approval_events (
    rota_id, department_id, tenant_id, vessel_id,
    event_type, actor_id, actor_tier, note, context
  ) VALUES (
    p_rota_id, p_department_id, v_tenant_id, v_vessel_id,
    'published_direct', auth.uid(), v_tier, p_note,
    jsonb_build_object(
      'snapshot_id',   v_snapshot_id,
      'rota_id',       p_rota_id,
      'department_id', p_department_id
    )
  );

  RETURN json_build_object(
    'snapshot_id',   v_snapshot_id,
    'status',        'published',
    'rota_id',       p_rota_id,
    'department_id', p_department_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.publish_rota_department_direct(uuid, uuid, text) TO authenticated;

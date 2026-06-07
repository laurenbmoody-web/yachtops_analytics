-- ─────────────────────────────────────────────────────────────────────────────
-- 20260605132000_rota_approve_writer.sql
--
-- WHAT: approve_rota_department(p_review_item_id, p_note) — RPC writer
--       for the CHIEF/COMMAND "approve" action on a submitted dept.
--       Atomically:
--         1. Resolves the review_item; must be pending + rota source.
--         2. Validates caller per Phase 1's routing predicate:
--              (CHIEF + dept-match) OR (COMMAND + NULL-dept).
--            The standard submit→approve path always lands at the
--            CHIEF-dept branch; the COMMAND-NULL branch reserves for
--            the future escalation case.
--         3. Confirms rota_department_status.status='pending_approval'.
--         4. Takes a snapshot via take_rota_shift_snapshot(...).
--         5. Flips every draft rota_shift in the dept to 'published'.
--         6. Flips rota_department_status → 'published', stamps
--            last_published_by / last_published_at, clears
--            has_unpublished_changes.
--         7. Writes an 'approved' rota_approval_events row.
--         8. Closes the review_item (status='accepted', decision_note,
--            decided_by, decided_at, updated_at).
--
-- Phase 2 of 6 — rota publish/review lifecycle.
--
-- WHY SECURITY DEFINER: see _131000 header (atomic multi-table writes
--       across review_items / rota_department_status / rota_shifts /
--       rota_approval_events / rota_shift_snapshots).
--
-- IDEMPOTENCY: CREATE OR REPLACE FUNCTION. Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.approve_rota_department(
  p_review_item_id  uuid,
  p_note            text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tenant_id        uuid;
  v_assignee_dept    uuid;
  v_source_context   jsonb;
  v_rota_id          uuid;
  v_department_id    uuid;
  v_dept_status_id   uuid;
  v_current_status   text;
  v_vessel_id        uuid;
  v_tier             text;
  v_member_dept_id   uuid;
  v_acting_tier      text;
  v_snapshot_id      uuid;
BEGIN
  -- (1) Look up review_item; must exist, pending, rota source.
  SELECT ri.tenant_id, ri.assignee_department_id, ri.source_context
    INTO v_tenant_id, v_assignee_dept, v_source_context
  FROM public.review_items ri
  WHERE ri.id = p_review_item_id
    AND ri.source_module = 'rota'
    AND ri.status = 'pending';

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Review item not found or not pending.'
      USING ERRCODE = 'P0002';
  END IF;

  v_rota_id       := (v_source_context->>'rota_id')::uuid;
  v_department_id := (v_source_context->>'department_id')::uuid;

  IF v_rota_id IS NULL OR v_department_id IS NULL THEN
    RAISE EXCEPTION 'Review item source_context missing rota_id or department_id.';
  END IF;

  -- (2) Validate caller per Phase 1's routing predicate. Capture which
  -- branch matched for the audit's actor_tier.
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

  IF v_tier = 'CHIEF' AND v_member_dept_id = v_assignee_dept THEN
    v_acting_tier := 'CHIEF';
  ELSIF v_tier = 'COMMAND' AND v_assignee_dept IS NULL THEN
    v_acting_tier := 'COMMAND';
  ELSE
    RAISE EXCEPTION 'You are not the routed assignee for this review.';
  END IF;

  -- (3) Look up dept status; must be pending_approval.
  SELECT rds.id, rds.status, rds.vessel_id
    INTO v_dept_status_id, v_current_status, v_vessel_id
  FROM public.rota_department_status rds
  WHERE rds.rota_id = v_rota_id
    AND rds.department_id = v_department_id;

  IF v_dept_status_id IS NULL THEN
    RAISE EXCEPTION 'No rota_department_status row for this (rota, department).'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_current_status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Cannot approve: department is in % state, expected pending_approval.',
      v_current_status;
  END IF;

  -- (4) Snapshot.
  v_snapshot_id := public.take_rota_shift_snapshot(v_rota_id, v_department_id, auth.uid());

  -- (5) Publish all the dept's draft shifts. The dept linkage is via
  -- member_id → tenant_members.department_id (rota_shifts has no direct
  -- department_id column).
  UPDATE public.rota_shifts
    SET status = 'published'
  WHERE rota_id = v_rota_id
    AND status = 'draft'
    AND member_id IN (
      SELECT tm.id FROM public.tenant_members tm
      WHERE tm.tenant_id = v_tenant_id
        AND tm.department_id = v_department_id
    );

  -- (6) Flip dept status.
  UPDATE public.rota_department_status
    SET status                  = 'published',
        last_published_by       = auth.uid(),
        last_published_at       = now(),
        has_unpublished_changes = false,
        updated_at              = now()
  WHERE id = v_dept_status_id;

  -- (7) Audit event.
  INSERT INTO public.rota_approval_events (
    rota_id, department_id, tenant_id, vessel_id,
    event_type, actor_id, actor_tier, note, context
  ) VALUES (
    v_rota_id, v_department_id, v_tenant_id, v_vessel_id,
    'approved', auth.uid(), v_acting_tier, p_note,
    jsonb_build_object(
      'review_item_id', p_review_item_id,
      'snapshot_id',    v_snapshot_id,
      'rota_id',        v_rota_id,
      'department_id',  v_department_id
    )
  );

  -- (8) Close the review_item.
  UPDATE public.review_items
    SET status        = 'accepted',
        decision_note = p_note,
        decided_by    = auth.uid(),
        decided_at    = now(),
        updated_at    = now()
  WHERE id = p_review_item_id;

  RETURN json_build_object(
    'review_item_id', p_review_item_id,
    'snapshot_id',    v_snapshot_id,
    'status',         'published',
    'rota_id',        v_rota_id,
    'department_id',  v_department_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.approve_rota_department(uuid, text) TO authenticated;

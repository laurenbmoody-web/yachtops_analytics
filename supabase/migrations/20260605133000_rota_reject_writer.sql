-- ─────────────────────────────────────────────────────────────────────────────
-- 20260605133000_rota_reject_writer.sql
--
-- WHAT: reject_rota_department(p_review_item_id, p_note) — RPC writer
--       for the CHIEF/COMMAND "reject" action on a submitted dept.
--       Atomically:
--         1. Requires a non-empty p_note. A rejection without a reason
--            is bad practice; enforced in the function body.
--         2. Resolves the review_item; must be pending + rota source.
--         3. Validates caller per Phase 1 routing predicate (same as
--            approve).
--         4. Confirms rota_department_status.status='pending_approval'.
--         5. Reverts status → 'draft', stamps last_rejection_note /
--            last_rejected_by / last_rejected_at. Does NOT clear
--            submitted_by / submitted_at — original submission
--            provenance is preserved.
--         6. Writes a 'rejected' rota_approval_events row.
--         7. Closes the review_item (status='rejected', decision_note,
--            decided_by, decided_at, updated_at).
--       No snapshot is taken on rejection — nothing is being published.
--       No rota_shifts are touched — the draft state retains them.
--
-- Phase 2 of 6 — rota publish/review lifecycle.
--
-- WHY SECURITY DEFINER: see _131000 header.
--
-- IDEMPOTENCY: CREATE OR REPLACE FUNCTION. Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reject_rota_department(
  p_review_item_id  uuid,
  p_note            text
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
BEGIN
  -- (0) Rejection reason is mandatory.
  IF p_note IS NULL OR length(trim(p_note)) = 0 THEN
    RAISE EXCEPTION 'A rejection reason is required.';
  END IF;

  -- (1) Look up review_item.
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

  -- (2) Validate caller per Phase 1 routing.
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
    RAISE EXCEPTION 'Cannot reject: department is in % state, expected pending_approval.',
      v_current_status;
  END IF;

  -- (4) Revert to draft, stamp rejection. Preserve submitted_by /
  -- submitted_at — the original submission provenance is retained.
  UPDATE public.rota_department_status
    SET status              = 'draft',
        last_rejection_note = p_note,
        last_rejected_by    = auth.uid(),
        last_rejected_at    = now(),
        updated_at          = now()
  WHERE id = v_dept_status_id;

  -- (5) Audit event.
  INSERT INTO public.rota_approval_events (
    rota_id, department_id, tenant_id, vessel_id,
    event_type, actor_id, actor_tier, note, context
  ) VALUES (
    v_rota_id, v_department_id, v_tenant_id, v_vessel_id,
    'rejected', auth.uid(), v_acting_tier, p_note,
    jsonb_build_object(
      'review_item_id', p_review_item_id,
      'rota_id',        v_rota_id,
      'department_id',  v_department_id
    )
  );

  -- (6) Close the review_item.
  UPDATE public.review_items
    SET status        = 'rejected',
        decision_note = p_note,
        decided_by    = auth.uid(),
        decided_at    = now(),
        updated_at    = now()
  WHERE id = p_review_item_id;

  RETURN json_build_object(
    'review_item_id', p_review_item_id,
    'status',         'draft',
    'rota_id',        v_rota_id,
    'department_id',  v_department_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reject_rota_department(uuid, text) TO authenticated;

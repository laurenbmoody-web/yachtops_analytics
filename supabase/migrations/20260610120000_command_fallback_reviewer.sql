-- ─────────────────────────────────────────────────────────────────────────────
-- 20260610120000_command_fallback_reviewer.sql
--
-- WHAT: Make COMMAND a true FALLBACK REVIEWER. Previously COMMAND could only
--       action review_items whose assignee_department_id IS NULL (the explicit
--       escalation lane) — a department routed to a CHIEF was off-limits to
--       COMMAND, by design (see 20260605120000 header: "COMMAND is INTENTIONALLY
--       excluded from the dept-owned path"). Founder direction reverses that:
--       COMMAND should be able to Accept/Reject ANY department's submission so a
--       department with no available CHIEF isn't stuck.
--
--       Three coordinated changes:
--         (1) review_items_assignee_update RLS — the COMMAND branch drops its
--             "assignee_department_id IS NULL" requirement: an active COMMAND in
--             the row's tenant may UPDATE any of its review_items.
--         (2) approve_rota_department — tier gate lets COMMAND act on any dept
--             (not only NULL-dept).
--         (3) reject_rota_department — same gate change.
--
--       CHIEF behaviour is unchanged: a CHIEF still acts only on their own
--       department's items. The app-side inbox (hooks/inboxScope.js) surfaces a
--       CHIEF-less department's submission to COMMAND so the fallback is
--       reachable, while CHIEF-served departments stay the CHIEF's to action.
--
-- NOT A RECOVERY MIGRATION: forward-going behavioural change.
--
-- IDEMPOTENCY: DROP POLICY IF EXISTS before CREATE; CREATE OR REPLACE FUNCTION
--       on both writers. Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────────────

-- (1) RLS — COMMAND may update any review_items row in their tenant.
DROP POLICY IF EXISTS "review_items_assignee_update" ON public.review_items;
CREATE POLICY "review_items_assignee_update" ON public.review_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.active = true
        AND tm.tenant_id = review_items.tenant_id
        AND (
          (
            tm.permission_tier = 'CHIEF'
            AND tm.department_id = review_items.assignee_department_id
          )
          OR tm.permission_tier = 'COMMAND'
        )))
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.active = true
        AND tm.tenant_id = review_items.tenant_id
        AND (
          (
            tm.permission_tier = 'CHIEF'
            AND tm.department_id = review_items.assignee_department_id
          )
          OR tm.permission_tier = 'COMMAND'
        )));

-- (2) approve_rota_department — COMMAND may approve any dept (fallback).
-- Body identical to 20260607131000 except the caller-authorisation gate.
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

  -- Authorisation: a CHIEF acts on their own department; COMMAND is the
  -- fallback reviewer for any department (Phase 4a-split).
  IF v_tier = 'CHIEF' AND v_member_dept_id = v_assignee_dept THEN
    v_acting_tier := 'CHIEF';
  ELSIF v_tier = 'COMMAND' THEN
    v_acting_tier := 'COMMAND';
  ELSE
    RAISE EXCEPTION 'You are not authorised to review this submission.';
  END IF;

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

  v_snapshot_id := public.take_rota_shift_snapshot(
    v_rota_id, v_department_id, auth.uid(), 'approved'
  );

  UPDATE public.rota_shifts
    SET status = 'published'
  WHERE rota_id = v_rota_id
    AND status = 'draft'
    AND member_id IN (
      SELECT tm.id FROM public.tenant_members tm
      WHERE tm.tenant_id = v_tenant_id
        AND tm.department_id = v_department_id
    );

  UPDATE public.rota_department_status
    SET status                  = 'published',
        last_published_by       = auth.uid(),
        last_published_at       = now(),
        has_unpublished_changes = false,
        updated_at              = now()
  WHERE id = v_dept_status_id;

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

-- (3) reject_rota_department — COMMAND may reject any dept (fallback).
-- Body identical to 20260605133000 except the caller-authorisation gate.
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
  IF p_note IS NULL OR length(trim(p_note)) = 0 THEN
    RAISE EXCEPTION 'A rejection reason is required.';
  END IF;

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

  -- Authorisation: a CHIEF acts on their own department; COMMAND is the
  -- fallback reviewer for any department (Phase 4a-split).
  IF v_tier = 'CHIEF' AND v_member_dept_id = v_assignee_dept THEN
    v_acting_tier := 'CHIEF';
  ELSIF v_tier = 'COMMAND' THEN
    v_acting_tier := 'COMMAND';
  ELSE
    RAISE EXCEPTION 'You are not authorised to review this submission.';
  END IF;

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

  UPDATE public.rota_department_status
    SET status              = 'draft',
        last_rejection_note = p_note,
        last_rejected_by    = auth.uid(),
        last_rejected_at    = now(),
        updated_at          = now()
  WHERE id = v_dept_status_id;

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

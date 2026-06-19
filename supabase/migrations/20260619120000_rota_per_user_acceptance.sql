-- Per-user rota action: Publish vs Send for acceptance.
--
-- tenant_members.rota_requires_acceptance (nullable boolean):
--   NULL  → tier default (HOD sends for acceptance; CHIEF/COMMAND publish)
--   true  → this member must SEND FOR ACCEPTANCE (their rota goes to review)
--   false → this member PUBLISHES directly (no review)
--
-- An admin / COMMAND sets this per user in crew management. The effective rule
-- (also applied in the UI) is COALESCE(rota_requires_acceptance, tier = 'HOD').
-- The two rota writers are widened so the override is honoured server-side:
--   • A CHIEF whose effective value is "send for acceptance" may now submit;
--     the submission is routed to COMMAND (assignee_tier COMMAND, NULL
--     department = explicit escalation per hooks/inboxScope.js).
--   • A HOD whose effective value is "publish" (override = false) may now
--     publish their own department directly.

ALTER TABLE public.tenant_members
  ADD COLUMN IF NOT EXISTS rota_requires_acceptance boolean;

COMMENT ON COLUMN public.tenant_members.rota_requires_acceptance IS
  'Per-user rota action override. NULL = tier default (HOD sends for acceptance, CHIEF/COMMAND publish), true = always send for acceptance, false = always publish directly.';


-- ── submit_rota_department ────────────────────────────────────────────────────
-- Send a department for acceptance. Now allows a CHIEF (in addition to HOD)
-- when their effective action is "send for acceptance"; a CHIEF's review is
-- assigned to COMMAND, a HOD's to the dept CHIEF (with COMMAND fallback).
CREATE OR REPLACE FUNCTION public.submit_rota_department(
  p_rota_id        uuid,
  p_department_id  uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tenant_id           uuid;
  v_vessel_id           uuid;
  v_rota_name           text;
  v_dept_name           text;
  v_status_id           uuid;
  v_current_status      text;
  v_has_unpublished     boolean;
  v_submitter_name      text;
  v_shift_count         integer;
  v_review_item_id      uuid;
  v_tier                text;
  v_member_dept_id      uuid;
  v_requires_acceptance boolean;
  v_assignee_tier       text;
  v_assignee_dept       uuid;
  v_snapshot_id         uuid;
BEGIN
  SELECT r.tenant_id, r.vessel_id, r.name
    INTO v_tenant_id, v_vessel_id, v_rota_name
  FROM public.rotas r
  WHERE r.id = p_rota_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Rota not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT tm.permission_tier, tm.department_id, tm.rota_requires_acceptance
    INTO v_tier, v_member_dept_id, v_requires_acceptance
  FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid()
    AND tm.tenant_id = v_tenant_id
    AND tm.active = true
  LIMIT 1;

  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'You are not an active member of this tenant.';
  END IF;

  IF v_tier NOT IN ('HOD', 'CHIEF') THEN
    RAISE EXCEPTION 'Only HODs or chiefs can send a department for acceptance.';
  END IF;

  -- Effective rule (matches the UI): NULL → HOD sends, CHIEF/COMMAND publish.
  IF COALESCE(v_requires_acceptance, v_tier = 'HOD') IS NOT TRUE THEN
    RAISE EXCEPTION 'This member publishes directly; sending for acceptance is not enabled for them.';
  END IF;

  IF v_member_dept_id IS DISTINCT FROM p_department_id THEN
    RAISE EXCEPTION 'You can only submit your own department.';
  END IF;

  SELECT rds.id, rds.status, rds.has_unpublished_changes
    INTO v_status_id, v_current_status, v_has_unpublished
  FROM public.rota_department_status rds
  WHERE rds.rota_id = p_rota_id
    AND rds.department_id = p_department_id;

  IF v_status_id IS NULL THEN
    RAISE EXCEPTION 'No rota_department_status row for this (rota, department).'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_current_status NOT IN ('draft', 'published') THEN
    RAISE EXCEPTION 'Cannot submit: department is in % state, expected draft or published.',
      v_current_status;
  END IF;

  IF v_current_status = 'published' AND COALESCE(v_has_unpublished, false) = false THEN
    RAISE EXCEPTION 'Cannot submit: this published department has no unpublished changes.';
  END IF;

  -- Status flip → pending_approval; the changes are now in review, so the
  -- "published with unpublished changes" flag is cleared (a reject re-sets it).
  UPDATE public.rota_department_status
    SET status                  = 'pending_approval',
        has_unpublished_changes = false,
        submitted_by            = auth.uid(),
        submitted_at            = now(),
        updated_at              = now()
  WHERE id = v_status_id;

  v_snapshot_id := public.take_rota_shift_snapshot(
    p_rota_id, p_department_id, auth.uid(), 'submitted'
  );

  INSERT INTO public.rota_approval_events (
    rota_id, department_id, tenant_id, vessel_id,
    event_type, actor_id, actor_tier, note, context
  ) VALUES (
    p_rota_id, p_department_id, v_tenant_id, v_vessel_id,
    'submitted', auth.uid(), v_tier, NULL,
    jsonb_build_object(
      'rota_id', p_rota_id,
      'department_id', p_department_id,
      'snapshot_id', v_snapshot_id
    )
  );

  SELECT d.name INTO v_dept_name
  FROM public.departments d
  WHERE d.id = p_department_id;

  SELECT COALESCE(
    p.full_name,
    NULLIF(trim(both ' ' FROM concat_ws(' ', p.first_name, p.last_name)), ''),
    p.email,
    ''
  )
  INTO v_submitter_name
  FROM public.profiles p
  WHERE p.id = auth.uid();

  SELECT count(*) INTO v_shift_count
  FROM public.rota_shifts s
  WHERE s.rota_id = p_rota_id
    AND s.member_id IN (
      SELECT tm.id FROM public.tenant_members tm
      WHERE tm.tenant_id = v_tenant_id
        AND tm.department_id = p_department_id
    );

  -- Route the review: a chief escalates to COMMAND (NULL dept = explicit
  -- escalation, always visible to COMMAND); a HOD goes to the dept CHIEF
  -- (with the existing COMMAND fallback for CHIEF-less departments).
  IF v_tier = 'CHIEF' THEN
    v_assignee_tier := 'COMMAND';
    v_assignee_dept := NULL;
  ELSE
    v_assignee_tier := 'CHIEF';
    v_assignee_dept := p_department_id;
  END IF;

  INSERT INTO public.review_items (
    tenant_id, source_module, source_id, source_context,
    assignee_tier, assignee_department_id,
    submitter_id, status
  ) VALUES (
    v_tenant_id, 'rota', v_status_id,
    jsonb_build_object(
      'rota_id',         p_rota_id,
      'department_id',   p_department_id,
      'rota_name',       v_rota_name,
      'department_name', v_dept_name,
      'submitter_name',  v_submitter_name,
      'shift_count',     v_shift_count,
      'snapshot_id',     v_snapshot_id
    ),
    v_assignee_tier, v_assignee_dept,
    auth.uid(), 'pending'
  )
  RETURNING id INTO v_review_item_id;

  RETURN json_build_object(
    'review_item_id', v_review_item_id,
    'snapshot_id',    v_snapshot_id,
    'status',         'pending_approval',
    'rota_id',        p_rota_id,
    'department_id',  p_department_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.submit_rota_department(uuid, uuid) TO authenticated;


-- ── publish_rota_department_direct ────────────────────────────────────────────
-- Publish a department's drafts directly. Now also allows a HOD to publish
-- their OWN department when their override is "publish" (rota_requires_acceptance
-- = false). COMMAND (any dept) and the dept CHIEF (own dept) are unchanged.
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
  v_tenant_id           uuid;
  v_vessel_id           uuid;
  v_dept_status_id      uuid;
  v_current_status      text;
  v_has_unpublished     boolean;
  v_tier                text;
  v_member_dept_id      uuid;
  v_requires_acceptance boolean;
  v_snapshot_id         uuid;
BEGIN
  SELECT r.tenant_id, r.vessel_id
    INTO v_tenant_id, v_vessel_id
  FROM public.rotas r
  WHERE r.id = p_rota_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Rota not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT tm.permission_tier, tm.department_id, tm.rota_requires_acceptance
    INTO v_tier, v_member_dept_id, v_requires_acceptance
  FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid()
    AND tm.tenant_id = v_tenant_id
    AND tm.active = true
  LIMIT 1;

  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'You are not an active member of this tenant.';
  END IF;

  IF v_tier = 'COMMAND' THEN
    NULL;
  ELSIF v_tier = 'CHIEF' AND v_member_dept_id = p_department_id THEN
    NULL;
  ELSIF v_tier = 'HOD' AND v_member_dept_id = p_department_id
        AND COALESCE(v_requires_acceptance, true) = false THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Only COMMAND, the dept CHIEF, or a direct-publish HOD can publish-direct.';
  END IF;

  SELECT rds.id, rds.status, rds.has_unpublished_changes
    INTO v_dept_status_id, v_current_status, v_has_unpublished
  FROM public.rota_department_status rds
  WHERE rds.rota_id = p_rota_id
    AND rds.department_id = p_department_id;

  IF v_dept_status_id IS NULL THEN
    RAISE EXCEPTION 'No rota_department_status row for this (rota, department).'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_current_status = 'pending_approval' THEN
    RAISE EXCEPTION 'Use approve_rota_department for a submitted dept; publish_direct is for draft (or a flagged published dept) only.';
  END IF;

  -- Accept draft, or a published dept that has unpublished changes.
  IF NOT (
    v_current_status = 'draft'
    OR (v_current_status = 'published' AND COALESCE(v_has_unpublished, false) = true)
  ) THEN
    RAISE EXCEPTION 'Cannot publish-direct: department is in % state with no unpublished changes.',
      v_current_status;
  END IF;

  v_snapshot_id := public.take_rota_shift_snapshot(
    p_rota_id, p_department_id, auth.uid(), 'published_direct'
  );

  UPDATE public.rota_shifts
    SET status = 'published'
  WHERE rota_id = p_rota_id
    AND status = 'draft'
    AND member_id IN (
      SELECT tm.id FROM public.tenant_members tm
      WHERE tm.tenant_id = v_tenant_id
        AND tm.department_id = p_department_id
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

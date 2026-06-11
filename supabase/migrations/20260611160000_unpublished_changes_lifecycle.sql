-- ─────────────────────────────────────────────────────────────────────────────
-- 20260611160000_unpublished_changes_lifecycle.sql
--
-- WHAT: Wire has_unpublished_changes into the rota lifecycle (Phase 6 #1,
--       "stay published + banner" model).
--
-- Until now, a HOD editing a PUBLISHED department silently reverted it to
-- draft, and has_unpublished_changes was never set true. New model: a HOD's
-- edit to a published dept keeps it PUBLISHED and flags has_unpublished_changes
-- so reviewers/owner see an "unpublished changes" badge; the live published
-- rota stays live until the changes are submitted + approved (or published
-- direct). State transitions added:
--
--   published --HOD edits-->            published (+ flag)   [mark_dept_unpublished_changes]
--   published(+flag) --submit-->        pending_approval     [submit guard widened]
--   pending_approval --approve-->       published (flag cleared)  [unchanged]
--   pending_approval --reject-->        published (+flag) if ever published,
--                                       else draft           [reject branch]
--   published(+flag) --publish_direct-->published (flag cleared)  [guard widened]
--
-- Scope note: the edit-keeps-published behaviour is HOD-only (enforced app-side
-- in ensureDraft); CHIEF/COMMAND edits still revert to draft, so their direct
-- publish flow is unchanged. publish_direct is widened so COMMAND/CHIEF can
-- still publish a HOD's flagged dept directly.
--
-- IDEMPOTENCY: CREATE OR REPLACE throughout. Re-runnable.
-- ─────────────────────────────────────────────────────────────────────────────

-- (1) NEW: flag a published dept as having unpublished changes. Authorised for
-- the owning HOD / the dept CHIEF / COMMAND. No-op unless the dept is published.
CREATE OR REPLACE FUNCTION public.mark_dept_unpublished_changes(
  p_rota_id        uuid,
  p_department_id  uuid,
  p_changed        boolean DEFAULT true
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tenant_id      uuid;
  v_status_id      uuid;
  v_current_status text;
  v_tier           text;
  v_member_dept_id uuid;
BEGIN
  SELECT r.tenant_id INTO v_tenant_id FROM public.rotas r WHERE r.id = p_rota_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Rota not found.' USING ERRCODE = 'P0002';
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

  IF NOT (
    (v_tier IN ('HOD', 'CHIEF') AND v_member_dept_id IS NOT DISTINCT FROM p_department_id)
    OR v_tier = 'COMMAND'
  ) THEN
    RAISE EXCEPTION 'Not authorised to edit this department.';
  END IF;

  SELECT rds.id, rds.status
    INTO v_status_id, v_current_status
  FROM public.rota_department_status rds
  WHERE rds.rota_id = p_rota_id
    AND rds.department_id = p_department_id;

  IF v_status_id IS NULL THEN
    RAISE EXCEPTION 'No rota_department_status row for this (rota, department).'
      USING ERRCODE = 'P0002';
  END IF;

  -- Only meaningful on a published dept; harmless no-op otherwise. p_changed
  -- lets callers clear the flag too (e.g. when a HOD discards their edits).
  IF v_current_status = 'published' THEN
    UPDATE public.rota_department_status
      SET has_unpublished_changes = COALESCE(p_changed, true),
          updated_at = now()
    WHERE id = v_status_id;
    RETURN json_build_object('ok', true, 'flagged', COALESCE(p_changed, true), 'status', 'published');
  END IF;

  RETURN json_build_object('ok', true, 'flagged', false, 'status', v_current_status);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.mark_dept_unpublished_changes(uuid, uuid, boolean) TO authenticated;


-- (2) submit_rota_department — widened to accept a published dept that has
-- unpublished changes (not just draft). Snapshot/audit/review-item logic is
-- unchanged from 20260607131000; only the start-state guard + the status flip
-- (which now clears the flag) differ.
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
  v_tenant_id        uuid;
  v_vessel_id        uuid;
  v_rota_name        text;
  v_dept_name        text;
  v_status_id        uuid;
  v_current_status   text;
  v_has_unpublished  boolean;
  v_submitter_name   text;
  v_shift_count      integer;
  v_review_item_id   uuid;
  v_tier             text;
  v_member_dept_id   uuid;
  v_snapshot_id      uuid;
BEGIN
  SELECT r.tenant_id, r.vessel_id, r.name
    INTO v_tenant_id, v_vessel_id, v_rota_name
  FROM public.rotas r
  WHERE r.id = p_rota_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Rota not found.' USING ERRCODE = 'P0002';
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

  IF v_tier <> 'HOD' THEN
    RAISE EXCEPTION 'Only HODs can submit a department for approval.';
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
    'submitted', auth.uid(), 'HOD', NULL,
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
    'CHIEF', p_department_id,
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


-- (3) reject_rota_department — body identical to 20260610120000 except the
-- landing state: if the dept was ever published (last_published_at set), reject
-- returns it to PUBLISHED with the unpublished-changes flag (the live rota stays
-- live, the HOD can revise & resubmit); otherwise it falls back to draft.
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
  v_tenant_id          uuid;
  v_assignee_dept      uuid;
  v_source_context     jsonb;
  v_rota_id            uuid;
  v_department_id      uuid;
  v_dept_status_id     uuid;
  v_current_status     text;
  v_vessel_id          uuid;
  v_last_published_at  timestamptz;
  v_tier               text;
  v_member_dept_id     uuid;
  v_acting_tier        text;
  v_landing_status     text;
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

  IF v_tier = 'CHIEF' AND v_member_dept_id = v_assignee_dept THEN
    v_acting_tier := 'CHIEF';
  ELSIF v_tier = 'COMMAND' THEN
    v_acting_tier := 'COMMAND';
  ELSE
    RAISE EXCEPTION 'You are not authorised to review this submission.';
  END IF;

  SELECT rds.id, rds.status, rds.vessel_id, rds.last_published_at
    INTO v_dept_status_id, v_current_status, v_vessel_id, v_last_published_at
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

  -- A previously-published dept returns to published + flagged (live rota stays
  -- live); a never-published dept falls back to draft.
  IF v_last_published_at IS NOT NULL THEN
    v_landing_status := 'published';
    UPDATE public.rota_department_status
      SET status                  = 'published',
          has_unpublished_changes = true,
          last_rejection_note     = p_note,
          last_rejected_by        = auth.uid(),
          last_rejected_at        = now(),
          updated_at              = now()
    WHERE id = v_dept_status_id;
  ELSE
    v_landing_status := 'draft';
    UPDATE public.rota_department_status
      SET status              = 'draft',
          last_rejection_note = p_note,
          last_rejected_by    = auth.uid(),
          last_rejected_at    = now(),
          updated_at          = now()
    WHERE id = v_dept_status_id;
  END IF;

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
    'status',         v_landing_status,
    'rota_id',        v_rota_id,
    'department_id',  v_department_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reject_rota_department(uuid, text) TO authenticated;


-- (4) publish_rota_department_direct — body identical to 20260605134000 except
-- the start-state guard now also accepts a published dept WITH unpublished
-- changes (so COMMAND/CHIEF can publish a HOD's flagged changes directly). The
-- existing body already publishes draft shifts → published and clears the flag.
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
  v_has_unpublished  boolean;
  v_tier             text;
  v_member_dept_id   uuid;
  v_snapshot_id      uuid;
BEGIN
  SELECT r.tenant_id, r.vessel_id
    INTO v_tenant_id, v_vessel_id
  FROM public.rotas r
  WHERE r.id = p_rota_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Rota not found.' USING ERRCODE = 'P0002';
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

  IF v_tier = 'COMMAND' THEN
    NULL;
  ELSIF v_tier = 'CHIEF' AND v_member_dept_id = p_department_id THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Only COMMAND or the dept CHIEF can publish-direct.';
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

  v_snapshot_id := public.take_rota_shift_snapshot(p_rota_id, p_department_id, auth.uid());

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

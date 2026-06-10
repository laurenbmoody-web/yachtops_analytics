-- ─────────────────────────────────────────────────────────────────────────────
-- 20260605131000_rota_submit_writer.sql
--
-- WHAT: submit_rota_department(rota, dept) — RPC writer for the HOD
--       "submit for approval" action. Atomically:
--         1. Validates caller is an active HOD whose department matches.
--         2. Confirms rota_department_status.status = 'draft'.
--         3. Flips status → 'pending_approval' and stamps
--            submitted_by / submitted_at / updated_at.
--         4. Writes a 'submitted' rota_approval_events row.
--         5. Inserts a review_items row for this submission, routed to
--            assignee_tier='CHIEF' + assignee_department_id=p_department_id
--            (the only valid routing under Phase 1's CHIEF + dept-match
--            update policy for dept-owned items).
--
-- Phase 2 of 6 — rota publish/review lifecycle. Companion to:
--   _130000 helpers, _132000 approve, _133000 reject, _134000 publish_direct.
--
-- WHY SECURITY DEFINER: the writer touches review_items (which restricts
--       UPDATE via assignee gate but INSERT is open to active members)
--       AND rota_department_status (which restricts HOD writes to result
--       in {draft, pending_approval}). DEFINER lets the function manage
--       the transaction without bumping into HOD's RLS edges from the
--       caller's perspective; the function's own validation logic is
--       the gate.
--
-- WHY ONE TRANSACTION: status flip + audit event + review_item must
--       all-or-nothing. If review_items insert fails (e.g. dept missing
--       from departments table), the whole submit rolls back rather than
--       leaving the dept in pending_approval with no inbox row.
--
-- KNOWN CORNER: if the tenant has no active CHIEF in this dept, the
--       review_item lands but is un-actionable until a CHIEF is added.
--       Phase 3 may want a pre-check; not enforced here.
--
-- IDEMPOTENCY: CREATE OR REPLACE FUNCTION. Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────────────

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
  v_submitter_name   text;
  v_shift_count      integer;
  v_review_item_id   uuid;
  v_tier             text;
  v_member_dept_id   uuid;
BEGIN
  -- (1) Resolve rota → tenant / vessel / name.
  SELECT r.tenant_id, r.vessel_id, r.name
    INTO v_tenant_id, v_vessel_id, v_rota_name
  FROM public.rotas r
  WHERE r.id = p_rota_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Rota not found.' USING ERRCODE = 'P0002';
  END IF;

  -- (2) Caller must be an active HOD in this tenant whose department
  -- matches the one being submitted.
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

  -- (3) Look up the rota_department_status row; must exist and be draft.
  SELECT rds.id, rds.status
    INTO v_status_id, v_current_status
  FROM public.rota_department_status rds
  WHERE rds.rota_id = p_rota_id
    AND rds.department_id = p_department_id;

  IF v_status_id IS NULL THEN
    RAISE EXCEPTION 'No rota_department_status row for this (rota, department).'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_current_status <> 'draft' THEN
    RAISE EXCEPTION 'Cannot submit: department is in % state, expected draft.',
      v_current_status;
  END IF;

  -- (4) Flip status.
  UPDATE public.rota_department_status
    SET status       = 'pending_approval',
        submitted_by = auth.uid(),
        submitted_at = now(),
        updated_at   = now()
  WHERE id = v_status_id;

  -- (5) Audit event.
  INSERT INTO public.rota_approval_events (
    rota_id, department_id, tenant_id, vessel_id,
    event_type, actor_id, actor_tier, note, context
  ) VALUES (
    p_rota_id, p_department_id, v_tenant_id, v_vessel_id,
    'submitted', auth.uid(), 'HOD', NULL,
    jsonb_build_object(
      'rota_id', p_rota_id,
      'department_id', p_department_id
    )
  );

  -- (6) Collect display fields for the review_item's source_context.
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

  -- (7) Push the inbox row. assignee_tier='CHIEF' + assignee_department_id
  -- = p_department_id matches Phase 1's routing CHECK for dept-owned items.
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
      'shift_count',     v_shift_count
    ),
    'CHIEF', p_department_id,
    auth.uid(), 'pending'
  )
  RETURNING id INTO v_review_item_id;

  RETURN json_build_object(
    'review_item_id', v_review_item_id,
    'status',         'pending_approval',
    'rota_id',        p_rota_id,
    'department_id',  p_department_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.submit_rota_department(uuid, uuid) TO authenticated;

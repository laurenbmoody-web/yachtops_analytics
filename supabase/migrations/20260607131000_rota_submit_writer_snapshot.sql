-- ─────────────────────────────────────────────────────────────────────────────
-- 20260607131000_rota_submit_writer_snapshot.sql
--
-- WHAT: Phase 4a extension to the rota lifecycle. Two coordinated changes:
--
--   (1) rota_shift_snapshots.source_event_type — new text column that
--       names WHICH writer produced the snapshot. Values:
--         'submitted'         — written by submit_rota_department (NEW)
--         'approved'          — written by approve_rota_department
--         'published_direct'  — written by publish_rota_department_direct
--       Phase 4b's "what Mary submitted vs what she edited" diff is keyed
--       on (rota_id, department_id, source_event_type='submitted'),
--       which is unambiguous; relying on timestamp guessing was the
--       alternative and would race against approve.
--
--   (2) take_rota_shift_snapshot signature gains a fourth arg
--       p_source_event_type text, stamped onto the new column. All three
--       existing callers are CREATE OR REPLACE'd to pass the matching
--       event type. The reject writer doesn't snapshot (no need; the
--       rejection moves the dept back to draft and the prior
--       submit-time snapshot already exists).
--
--   submit_rota_department additionally now writes a snapshot inside
--   its transaction body — between the status flip and the audit event
--   insert. The whole submit becomes status flip + snapshot + audit
--   event + review_item, all-or-nothing.
--
-- NOT A RECOVERY MIGRATION: forward-going. Phase 4a of the rota
--       publish/review lifecycle workstream.
--
-- IDEMPOTENCY:
--   * ALTER TABLE ADD COLUMN IF NOT EXISTS for source_event_type.
--   * CHECK constraint added with DO block guard so re-runs don't
--     duplicate it.
--   * DROP FUNCTION on the old take_rota_shift_snapshot signature
--     (uuid, uuid, uuid) before re-creating with the new one. Postgres
--     identifies functions by full signature; the old signature has to
--     be explicitly dropped so the new (uuid, uuid, uuid, text) signature
--     doesn't collide.
--   * CREATE OR REPLACE FUNCTION on all four writers (helper + three).
--   Safe to re-apply.
--
-- WHY KEEP NULL ALLOWABLE on source_event_type: defensive. No live rows
--       exist (snapshots have never been written; the table is empty
--       until this phase's writers run). The column is nullable so the
--       migration applies to environments where the live table might
--       have unrelated pre-existing rows from out-of-band testing.
-- ─────────────────────────────────────────────────────────────────────────────

-- (1) Schema: source_event_type column + CHECK constraint.

ALTER TABLE public.rota_shift_snapshots
  ADD COLUMN IF NOT EXISTS source_event_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rota_shift_snapshots_source_event_type_check'
      AND conrelid = 'public.rota_shift_snapshots'::regclass
  ) THEN
    ALTER TABLE public.rota_shift_snapshots
      ADD CONSTRAINT rota_shift_snapshots_source_event_type_check
        CHECK (source_event_type IS NULL OR source_event_type = ANY (ARRAY[
          'submitted'::text,
          'approved'::text,
          'published_direct'::text
        ]));
  END IF;
END $$;

-- Index for the Phase 4b lookup path: "find the submitted-time snapshot
-- for this (rota, dept)". Partial on submitted to keep the index lean —
-- approved/published_direct snapshots accumulate; submitted snapshots
-- are typically zero-or-one per (rota, dept) at any moment.
CREATE INDEX IF NOT EXISTS idx_rota_snapshots_submitted_lookup
  ON public.rota_shift_snapshots USING btree (rota_id, department_id, snapshot_taken_at DESC)
  WHERE (source_event_type = 'submitted'::text);

-- (2) Drop the old helper signature and re-create with p_source_event_type.

DROP FUNCTION IF EXISTS public.take_rota_shift_snapshot(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.take_rota_shift_snapshot(
  p_rota_id            uuid,
  p_department_id      uuid,
  p_taken_by           uuid,
  p_source_event_type  text
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
  IF p_source_event_type IS NULL OR p_source_event_type NOT IN ('submitted', 'approved', 'published_direct') THEN
    RAISE EXCEPTION 'take_rota_shift_snapshot: p_source_event_type must be one of {submitted, approved, published_direct}, got %.', COALESCE(p_source_event_type, 'NULL');
  END IF;

  SELECT r.tenant_id, r.vessel_id
    INTO v_tenant_id, v_vessel_id
  FROM public.rotas r
  WHERE r.id = p_rota_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Rota not found.' USING ERRCODE = 'P0002';
  END IF;

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
    shift_data, date_start, date_end, shift_count,
    source_event_type
  ) VALUES (
    p_rota_id, p_department_id, v_tenant_id, v_vessel_id,
    now(), p_taken_by,
    v_shift_data, v_date_start, v_date_end, v_shift_count,
    p_source_event_type
  )
  RETURNING id INTO v_snapshot_id;

  RETURN v_snapshot_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.take_rota_shift_snapshot(uuid, uuid, uuid, text) TO authenticated;

-- (3) submit_rota_department — now snapshots inside its transaction.
-- Phase 4b's diff baseline reads the resulting (rota, dept,
-- source_event_type='submitted') row.

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

  -- Status flip.
  UPDATE public.rota_department_status
    SET status       = 'pending_approval',
        submitted_by = auth.uid(),
        submitted_at = now(),
        updated_at   = now()
  WHERE id = v_status_id;

  -- (NEW in Phase 4a) Snapshot at submit time. Phase 4b reads this back
  -- by (rota_id, department_id, source_event_type='submitted') as the
  -- diff baseline against the rota's live shifts.
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

-- (4) approve_rota_department — same body as Phase 2 but the
-- take_rota_shift_snapshot call now passes 'approved'.

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

  IF v_tier = 'CHIEF' AND v_member_dept_id = v_assignee_dept THEN
    v_acting_tier := 'CHIEF';
  ELSIF v_tier = 'COMMAND' AND v_assignee_dept IS NULL THEN
    v_acting_tier := 'COMMAND';
  ELSE
    RAISE EXCEPTION 'You are not the routed assignee for this review.';
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

  -- Phase 4a: pass 'approved' so the snapshot is identifiable as the
  -- publish-time reference (vs the submit-time baseline).
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

-- (5) publish_rota_department_direct — same body as Phase 2 but the
-- take_rota_shift_snapshot call now passes 'published_direct'.

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

  -- Phase 4a: pass 'published_direct'.
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

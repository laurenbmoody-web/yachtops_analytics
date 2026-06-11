-- ─────────────────────────────────────────────────────────────────────────────
-- 20260611150000_clear_rota_writer.sql
--
-- WHAT: clear_rota(p_rota_id, p_scope, p_date) — a COMMAND-only writer that
--       clears a rota day or the whole rota AND tidies up after itself, so a
--       clear no longer leaves stale pending submissions in chiefs' /reviews
--       queues.
--
-- WHY: the previous clear was a client-side DELETE on rota_shifts only — it
--       deliberately left review_items + rota_department_status untouched.
--       Result: COMMAND wipes the rota, but the chief still sees the dead
--       submission. New rule: clearing a day or the entire rota also clears the
--       pending review submissions for the affected departments, and resets
--       those departments (which were therefore in 'pending_approval') back to
--       'draft'. Published departments are NOT touched.
--
-- SCOPE per call:
--   'all'  → every shift on the rota; every pending rota review_item for it.
--   'day'  → shifts on p_date; pending review_items for the departments that
--            had shifts on that day (a submission that included the cleared day
--            no longer matches what the chief was asked to review).
--
-- SECURITY DEFINER: authorises the caller as an active COMMAND member of the
--   rota's tenant, then bypasses RLS to delete across rota_shifts/review_items
--   and update rota_department_status atomically.
--
-- IDEMPOTENCY: CREATE OR REPLACE FUNCTION. Re-runnable.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.clear_rota(
  p_rota_id  uuid,
  p_scope    text,                 -- 'all' | 'day'
  p_date     date DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tenant_id      uuid;
  v_affected_depts uuid[];
  v_shifts_deleted int := 0;
  v_reviews_cleared int := 0;
  v_is_day         boolean := (p_scope = 'day');
BEGIN
  IF p_scope NOT IN ('all', 'day') THEN
    RAISE EXCEPTION 'p_scope must be ''all'' or ''day''.' USING ERRCODE = '22023';
  END IF;
  IF v_is_day AND p_date IS NULL THEN
    RAISE EXCEPTION 'A day clear requires p_date.' USING ERRCODE = '22023';
  END IF;

  SELECT r.tenant_id INTO v_tenant_id FROM public.rotas r WHERE r.id = p_rota_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Rota not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Authorise: active COMMAND in the rota's tenant.
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.user_id = auth.uid()
      AND tm.active = true
      AND tm.tenant_id = v_tenant_id
      AND tm.permission_tier = 'COMMAND'
  ) THEN
    RAISE EXCEPTION 'Only COMMAND can clear a rota.' USING ERRCODE = '42501';
  END IF;

  -- Departments with shifts in scope, captured BEFORE the delete (used to scope
  -- the day case; informational for the 'all' case).
  IF v_is_day THEN
    SELECT array_agg(DISTINCT tm.department_id)
      INTO v_affected_depts
      FROM public.rota_shifts rs
      JOIN public.tenant_members tm ON tm.id = rs.member_id
     WHERE rs.rota_id = p_rota_id AND rs.shift_date = p_date;

    DELETE FROM public.rota_shifts
     WHERE rota_id = p_rota_id AND shift_date = p_date;
    GET DIAGNOSTICS v_shifts_deleted = ROW_COUNT;
  ELSE
    DELETE FROM public.rota_shifts WHERE rota_id = p_rota_id;
    GET DIAGNOSTICS v_shifts_deleted = ROW_COUNT;
  END IF;

  v_affected_depts := COALESCE(v_affected_depts, ARRAY[]::uuid[]);

  -- Clear pending rota review submissions for this rota (scoped to the affected
  -- departments for a day clear).
  DELETE FROM public.review_items ri
   WHERE ri.tenant_id = v_tenant_id
     AND ri.source_module = 'rota'
     AND ri.status = 'pending'
     AND (ri.source_context->>'rota_id')::uuid = p_rota_id
     AND (NOT v_is_day OR ri.assignee_department_id = ANY (v_affected_depts));
  GET DIAGNOSTICS v_reviews_cleared = ROW_COUNT;

  -- The departments whose submissions we just voided were in 'pending_approval'
  -- — send them back to 'draft' so the HOD can rebuild/resubmit. Published
  -- departments are intentionally left alone.
  UPDATE public.rota_department_status
     SET status = 'draft',
         has_unpublished_changes = false,
         updated_at = now()
   WHERE rota_id = p_rota_id
     AND status = 'pending_approval'
     AND (NOT v_is_day OR department_id = ANY (v_affected_depts));

  RETURN json_build_object(
    'ok',              true,
    'scope',           p_scope,
    'shifts_deleted',  v_shifts_deleted,
    'reviews_cleared', v_reviews_cleared
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.clear_rota(uuid, text, date) TO authenticated;

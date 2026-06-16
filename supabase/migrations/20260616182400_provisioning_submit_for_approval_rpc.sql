-- ─────────────────────────────────────────────────────────────────────────────
-- 20260616182400_provisioning_submit_for_approval_rpc.sql
--
-- PR 2 of the approval-routing feature.
--
-- Adds public.submit_provisioning_for_approval(p_list_id uuid) — the
-- atomic RPC the board's Submit for Approval button calls. Does
-- everything in one transaction:
--
--   1. Loads the list + its tenant, resolves the approver via PR1's
--      resolve_provisioning_approver helper.
--   2. Inserts a provisioning_approval_requests row (status = pending,
--      submitter = auth.uid()).
--   3. Cancels any previous open pending request on the same list
--      (so the active reviewer is always the most recent target).
--   4. Updates provisioning_lists.status = 'pending_approval'.
--   5. Inserts a public.notifications row of type
--      PROVISIONING_APPROVAL_PENDING for the approver, with an
--      action_url pointing at the board.
--   6. Returns a small JSON object with the approver's display name
--      so the client toast can read "Sent to <name> for review".
--
-- Status guard: the board must be in 'draft' status. Re-submit from any
-- other status (incl. an existing pending_approval) is a no-op error
-- the UI prevents — RPC also enforces it defensively.
--
-- IDEMPOTENT: CREATE OR REPLACE on the function; no schema changes here.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_provisioning_for_approval(
  p_list_id uuid,
  p_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid             uuid := auth.uid();
  v_tenant_id       uuid;
  v_current_status  text;
  v_approver_id     uuid;
  v_approver_name   text;
  v_list_title      text;
  v_submitter_name  text;
  v_request_id      uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF p_list_id IS NULL THEN
    RAISE EXCEPTION 'list_id is required';
  END IF;

  -- 1. Load list, verify caller is a tenant member, verify draft status.
  SELECT pl.tenant_id, pl.status, COALESCE(pl.title, 'Untitled board')
    INTO v_tenant_id, v_current_status, v_list_title
  FROM public.provisioning_lists pl
  WHERE pl.id = p_list_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Provisioning list % not found', p_list_id
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.user_id = v_uid
      AND tm.tenant_id = v_tenant_id
      AND tm.active IS NOT FALSE
  ) THEN
    RAISE EXCEPTION 'You are not an active member of this vessel.';
  END IF;

  IF v_current_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Board status is "%" — only draft boards may be submitted for approval.',
                    v_current_status
      USING ERRCODE = 'P0004';
  END IF;

  -- 2. Resolve the approver (PR1 helper).
  v_approver_id := public.resolve_provisioning_approver(p_list_id, v_uid);
  IF v_approver_id IS NULL THEN
    RAISE EXCEPTION 'Could not resolve an approver for this submission.'
      USING ERRCODE = 'P0003';
  END IF;

  -- 3. Cancel any previous pending request on this list so we only ever
  -- have one active reviewer. Approved/declined rows stay as history.
  UPDATE public.provisioning_approval_requests
     SET status      = 'cancelled',
         decided_at  = now()
   WHERE list_id = p_list_id
     AND status  = 'pending';

  -- 4. Insert the new request.
  INSERT INTO public.provisioning_approval_requests
    (list_id, tenant_id, submitter_id, approver_id, status, comment)
  VALUES
    (p_list_id, v_tenant_id, v_uid, v_approver_id, 'pending', NULLIF(btrim(p_comment), ''))
  RETURNING id INTO v_request_id;

  -- 5. Flip the board status.
  UPDATE public.provisioning_lists
     SET status     = 'pending_approval',
         updated_at = now()
   WHERE id = p_list_id;

  -- 6. Look up display names for the notification + toast.
  SELECT COALESCE(p.full_name, split_part(p.email, '@', 1))
    INTO v_approver_name
  FROM public.profiles p
  WHERE p.id = v_approver_id;
  v_approver_name := COALESCE(v_approver_name, 'approver');

  SELECT COALESCE(p.full_name, split_part(p.email, '@', 1))
    INTO v_submitter_name
  FROM public.profiles p
  WHERE p.id = v_uid;
  v_submitter_name := COALESCE(v_submitter_name, 'A crew member');

  -- 7. Notification for the approver. We keep this best-effort: if the
  -- notifications table is missing or RLS-locked we don't want to roll
  -- back the submission, since the request itself is the source of
  -- truth and the inbox can backfill from it.
  BEGIN
    INSERT INTO public.notifications (user_id, type, title, message, severity, action_url)
    VALUES (
      v_approver_id,
      'PROVISIONING_APPROVAL_PENDING',
      'Review requested',
      format('%s submitted "%s" for your approval.', v_submitter_name, v_list_title),
      'info',
      format('/provisioning/%s', p_list_id)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- swallow, see comment above
  END;

  RETURN jsonb_build_object(
    'request_id',     v_request_id,
    'approver_id',    v_approver_id,
    'approver_name',  v_approver_name,
    'status',         'pending_approval'
  );
END;
$function$;

COMMENT ON FUNCTION public.submit_provisioning_for_approval(uuid, text) IS
  'Submits a draft provisioning_lists board for approval. Resolves the
   approver via resolve_provisioning_approver, inserts a
   provisioning_approval_requests row, cancels any prior pending request,
   flips the list status to pending_approval, and notifies the approver.
   Returns a JSONB { request_id, approver_id, approver_name, status }.
   Throws P0002 (list missing), P0003 (no approver available), or
   P0004 (board not in draft status).';

GRANT EXECUTE ON FUNCTION public.submit_provisioning_for_approval(uuid, text)
  TO authenticated;

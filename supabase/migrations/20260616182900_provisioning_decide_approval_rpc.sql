-- ─────────────────────────────────────────────────────────────────────────────
-- 20260616182900_provisioning_decide_approval_rpc.sql
--
-- PR 3 of the approval-routing feature.
--
-- Adds the reviewer's side of the loop:
--
--   1. public.decide_provisioning_approval(p_request_id, p_decision,
--      p_comment) — atomic RPC the approver calls when they Approve or
--      Request changes on a pending request. Flips the request status,
--      stamps decided_at, flips the board back to draft (so the
--      submitter can re-send or edit), and posts a notification back
--      to the submitter.
--
--   2. A small view public.provisioning_active_approval (no security
--      barrier — the underlying table's RLS still applies). Surfaces
--      "the current approval state of a list" without each consumer
--      reinventing the latest-row lookup.
--
-- IDEMPOTENT throughout.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.decide_provisioning_approval(
  p_request_id uuid,
  p_decision   text,
  p_comment    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid             uuid := auth.uid();
  v_request         public.provisioning_approval_requests%ROWTYPE;
  v_list_title      text;
  v_decider_name    text;
  v_new_request_st  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id is required';
  END IF;

  IF p_decision NOT IN ('approve', 'request_changes') THEN
    RAISE EXCEPTION 'decision must be approve or request_changes (got: %)', p_decision;
  END IF;

  -- Request changes requires a comment so the submitter knows what to fix.
  IF p_decision = 'request_changes' AND (p_comment IS NULL OR length(btrim(p_comment)) = 0) THEN
    RAISE EXCEPTION 'A comment is required when requesting changes.'
      USING ERRCODE = 'P0005';
  END IF;

  SELECT * INTO v_request
  FROM public.provisioning_approval_requests
  WHERE id = p_request_id;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'Approval request % not found', p_request_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_request.approver_id <> v_uid THEN
    RAISE EXCEPTION 'Only the assigned approver can decide on this request.'
      USING ERRCODE = 'P0006';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'This request was already decided (status: %).', v_request.status
      USING ERRCODE = 'P0007';
  END IF;

  v_new_request_st := CASE p_decision
    WHEN 'approve'         THEN 'approved'
    WHEN 'request_changes' THEN 'changes_requested'
  END;

  UPDATE public.provisioning_approval_requests
     SET status     = v_new_request_st,
         comment    = COALESCE(NULLIF(btrim(p_comment), ''), comment),
         decided_at = now()
   WHERE id = p_request_id;

  -- Both outcomes return the board to draft so the submitter can either
  -- re-send (approve) or revise (request_changes). The "approved" vs
  -- "changes_requested" distinction is carried by the approval_request
  -- row, not the list status — keeps the existing provisioning lifecycle
  -- enum unchanged.
  UPDATE public.provisioning_lists
     SET status     = 'draft',
         updated_at = now()
   WHERE id = v_request.list_id;

  SELECT COALESCE(title, 'Untitled board') INTO v_list_title
  FROM public.provisioning_lists WHERE id = v_request.list_id;

  SELECT COALESCE(p.full_name, split_part(p.email, '@', 1))
    INTO v_decider_name
  FROM public.profiles p
  WHERE p.id = v_uid;
  v_decider_name := COALESCE(v_decider_name, 'The approver');

  -- Notify the submitter. Best-effort — see PR2 rationale.
  BEGIN
    INSERT INTO public.notifications (user_id, type, title, message, severity, action_url)
    VALUES (
      v_request.submitter_id,
      'PROVISIONING_APPROVAL_DECIDED',
      CASE p_decision
        WHEN 'approve'         THEN 'Approved'
        WHEN 'request_changes' THEN 'Changes requested'
      END,
      CASE p_decision
        WHEN 'approve'         THEN format('%s approved "%s".', v_decider_name, v_list_title)
        WHEN 'request_changes' THEN format('%s requested changes on "%s".', v_decider_name, v_list_title)
      END,
      CASE p_decision
        WHEN 'request_changes' THEN 'warn'
        ELSE 'info'
      END,
      format('/provisioning/%s', v_request.list_id)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'request_id',    p_request_id,
    'list_id',       v_request.list_id,
    'status',        v_new_request_st,
    'decided_at',    now(),
    'decider_name',  v_decider_name
  );
END;
$function$;

COMMENT ON FUNCTION public.decide_provisioning_approval(uuid, text, text) IS
  'Approver decides on a pending provisioning_approval_requests row.
   p_decision in (approve, request_changes); request_changes requires a
   non-empty comment. Both outcomes return the underlying board to draft.
   Throws P0002 (request not found), P0005 (missing comment),
   P0006 (caller is not the approver), P0007 (request already decided).';

GRANT EXECUTE ON FUNCTION public.decide_provisioning_approval(uuid, text, text)
  TO authenticated;


-- ── View: current approval state for a list ───────────────────────────────
-- Returns the most recent approval request row per list (NULL when the
-- board has never been submitted). Consumers use this for "is there a
-- pending review?" / "what was the last decision?" without each having
-- to roll its own ORDER BY ... LIMIT 1 lookup.

CREATE OR REPLACE VIEW public.provisioning_active_approval
WITH (security_invoker = true)
AS
SELECT DISTINCT ON (par.list_id)
  par.id,
  par.list_id,
  par.tenant_id,
  par.submitter_id,
  par.approver_id,
  par.status,
  par.comment,
  par.created_at,
  par.decided_at
FROM public.provisioning_approval_requests par
ORDER BY par.list_id, par.created_at DESC;

COMMENT ON VIEW public.provisioning_active_approval IS
  'Most recent approval request per provisioning_lists row. Honours the
   underlying table''s RLS via security_invoker so consumers see only
   rows they are permitted to read.';

GRANT SELECT ON public.provisioning_active_approval TO authenticated;

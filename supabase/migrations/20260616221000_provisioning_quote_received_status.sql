-- ─────────────────────────────────────────────────────────────────────────────
-- 20260616221000_provisioning_quote_received_status.sql
--
-- Re-approval workflow PR 1/3.
--
-- Adds the `quote_received` board state so a board can be re-submitted
-- for approval AFTER the supplier has come back with quoted prices.
-- Today the lifecycle hard-caps approval at `draft`; once you've sent
-- to a supplier and quotes start landing, there's nowhere to take the
-- board for a second sign-off on the actual numbers (often different
-- from the estimates the chief originally approved).
--
-- This migration:
--
--   1. Extends provisioning_lists.status CHECK to include
--      `quote_received`.
--
--   2. Adds provisioning_approval_requests.prev_status so the decide
--      RPC can return the board to the status it was submitted FROM
--      (draft → draft after approval; quote_received → quote_received
--      so the supplier link survives). Default '' for already-existing
--      rows so the decide RPC's COALESCE falls back to 'draft' for
--      historical requests.
--
--   3. Relaxes submit_provisioning_for_approval to accept either
--      `draft` or `quote_received`, and captures prev_status on the
--      new request row.
--
--   4. Updates decide_provisioning_approval to return the board to
--      prev_status (defaulting to 'draft' for legacy rows).
--
--   5. Adds an AFTER UPDATE trigger on supplier_order_items that
--      flips the parent provisioning_list to `quote_received` as
--      soon as any line's `quoted_at` lands. Fires for both auto-
--      accepted quotes (status='agreed') and review-needed quotes
--      (status='quoted') — the vessel may want to re-approve regardless,
--      so making `quote_received` reachable in both cases is the right
--      default.
--
-- PR 2 surfaces the new state in the board UI (status chip, "Re-submit"
-- relabel on the button). PR 3 wires the quote-file upload path so a
-- PDF quote also triggers the flip.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. CHECK constraint ────────────────────────────────────────────────────

ALTER TABLE public.provisioning_lists
  DROP CONSTRAINT IF EXISTS provisioning_lists_status_check;

ALTER TABLE public.provisioning_lists
  ADD CONSTRAINT provisioning_lists_status_check
  CHECK (status IN (
    'draft',
    'pending_approval',
    'quote_received',
    'sent_to_supplier',
    'partially_delivered',
    'delivered_with_discrepancies',
    'delivered'
  ));


-- ── 2. prev_status on the approval request ────────────────────────────────

ALTER TABLE public.provisioning_approval_requests
  ADD COLUMN IF NOT EXISTS prev_status text;

COMMENT ON COLUMN public.provisioning_approval_requests.prev_status IS
  'The board status the submitter was sitting on when they hit Submit
   for Approval. Decide RPC returns the board to this on approve /
   request_changes so re-approval after a supplier quote does NOT lose
   the supplier link (would otherwise drop to draft and orphan the
   downstream supplier_orders).';


-- ── 3. Relaxed submit RPC ──────────────────────────────────────────────────

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

  -- Allow submission from draft (initial) or quote_received
  -- (re-approval after a supplier quote arrived). Any other status is
  -- a no-op error.
  IF v_current_status NOT IN ('draft', 'quote_received') THEN
    RAISE EXCEPTION 'Board status is "%" — submit for approval is only available from draft or quote_received.',
                    v_current_status
      USING ERRCODE = 'P0004';
  END IF;

  v_approver_id := public.resolve_provisioning_approver(p_list_id, v_uid);
  IF v_approver_id IS NULL THEN
    RAISE EXCEPTION 'Could not resolve an approver for this submission.'
      USING ERRCODE = 'P0003';
  END IF;

  -- Cancel any prior pending request so the active reviewer is always
  -- the most recent target.
  UPDATE public.provisioning_approval_requests
     SET status      = 'cancelled',
         decided_at  = now()
   WHERE list_id = p_list_id
     AND status  = 'pending';

  INSERT INTO public.provisioning_approval_requests
    (list_id, tenant_id, submitter_id, approver_id, status, comment, prev_status)
  VALUES
    (p_list_id, v_tenant_id, v_uid, v_approver_id, 'pending',
     NULLIF(btrim(p_comment), ''), v_current_status)
  RETURNING id INTO v_request_id;

  UPDATE public.provisioning_lists
     SET status     = 'pending_approval',
         updated_at = now()
   WHERE id = p_list_id;

  SELECT COALESCE(p.full_name, split_part(p.email, '@', 1))
    INTO v_approver_name
  FROM public.profiles p WHERE p.id = v_approver_id;
  v_approver_name := COALESCE(v_approver_name, 'approver');

  SELECT COALESCE(p.full_name, split_part(p.email, '@', 1))
    INTO v_submitter_name
  FROM public.profiles p WHERE p.id = v_uid;
  v_submitter_name := COALESCE(v_submitter_name, 'A crew member');

  BEGIN
    INSERT INTO public.notifications (user_id, type, title, message, severity, action_url)
    VALUES (
      v_approver_id,
      'PROVISIONING_APPROVAL_PENDING',
      CASE WHEN v_current_status = 'quote_received'
           THEN 'Quote review requested'
           ELSE 'Review requested' END,
      CASE WHEN v_current_status = 'quote_received'
           THEN format('%s re-submitted "%s" with supplier quotes for your approval.', v_submitter_name, v_list_title)
           ELSE format('%s submitted "%s" for your approval.', v_submitter_name, v_list_title) END,
      'info',
      format('/provisioning/%s', p_list_id)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'request_id',     v_request_id,
    'approver_id',    v_approver_id,
    'approver_name',  v_approver_name,
    'status',         'pending_approval',
    'prev_status',    v_current_status
  );
END;
$function$;


-- ── 4. Decide RPC returns to prev_status ──────────────────────────────────

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
  v_return_status   text;
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

  -- Return the board to the status it came from. Legacy rows without
  -- prev_status (pre-PR1) default to 'draft', matching the previous
  -- decide behaviour.
  v_return_status := COALESCE(v_request.prev_status, 'draft');

  UPDATE public.provisioning_approval_requests
     SET status     = v_new_request_st,
         comment    = COALESCE(NULLIF(btrim(p_comment), ''), comment),
         decided_at = now()
   WHERE id = p_request_id;

  UPDATE public.provisioning_lists
     SET status     = v_return_status,
         updated_at = now()
   WHERE id = v_request.list_id;

  SELECT COALESCE(title, 'Untitled board') INTO v_list_title
  FROM public.provisioning_lists WHERE id = v_request.list_id;

  SELECT COALESCE(p.full_name, split_part(p.email, '@', 1))
    INTO v_decider_name
  FROM public.profiles p WHERE p.id = v_uid;
  v_decider_name := COALESCE(v_decider_name, 'The approver');

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
    'list_status',   v_return_status,
    'decided_at',    now(),
    'decider_name',  v_decider_name
  );
END;
$function$;


-- ── 5. Trigger: flip list to quote_received when a quote lands ────────────
--
-- AFTER UPDATE on supplier_order_items, fires when the row's quoted_at
-- transitions from NULL → not NULL (a brand-new quote arrived) OR
-- when quoted_at changes (a fresh quote on a previously-quoted line).
-- Walks supplier_order_items → supplier_orders → provisioning_lists
-- and flips the list if it's currently 'sent_to_supplier'. Other
-- statuses (already in quote_received, already pending_approval,
-- past the fulfilment line, etc.) are left untouched so we don't
-- regress the lifecycle.

CREATE OR REPLACE FUNCTION public.handle_supplier_quote_for_list_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_list_id uuid;
BEGIN
  IF NEW.quoted_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.quoted_at IS NOT DISTINCT FROM NEW.quoted_at THEN
    RETURN NEW;
  END IF;

  SELECT so.list_id INTO v_list_id
  FROM public.supplier_orders so
  WHERE so.id = NEW.supplier_order_id;

  IF v_list_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.provisioning_lists
     SET status     = 'quote_received',
         updated_at = now()
   WHERE id = v_list_id
     AND status = 'sent_to_supplier';

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS supplier_order_items_quote_to_list_status
  ON public.supplier_order_items;

CREATE TRIGGER supplier_order_items_quote_to_list_status
  AFTER UPDATE ON public.supplier_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_supplier_quote_for_list_status();

COMMENT ON FUNCTION public.handle_supplier_quote_for_list_status IS
  'Flips the parent provisioning_list to quote_received the first time
   a supplier quote arrives on any line, IFF the list is currently
   sent_to_supplier. Lets the chief see "Quote in — re-submit?" on the
   board and Submit for Approval becomes available again.';

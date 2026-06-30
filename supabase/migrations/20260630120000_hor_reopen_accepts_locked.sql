-- hor_reopen_month — allow reopening a LOCKED month, not only submitted/confirmed.
--
-- WHY: once a month is signed off it auto-locks and the HOR editor is read-only.
-- The only way back to editing is "Unlock" (reopen), but the prior definition
-- (_141000, re-defined in _signatures) rejected status 'locked' with
--   "Cannot reopen: month is %, expected submitted or confirmed."
-- so a locked month — including a COMMAND user's own self-certified month — was
-- a dead end. Reopening must also work from 'locked'.
--
-- BEHAVIOUR (unchanged otherwise): reopen returns the month to 'open' and wipes
-- the sign-off + both signatures, so the record goes back to the crew member to
-- sign again and resubmit. This revision additionally accepts 'locked' and
-- clears locked_at/locked_by. Permission is unchanged: COMMAND or the vessel's
-- approver tier — and since there is no own-subject restriction, a COMMAND user
-- who self-certifies can unlock their own month.
--
-- IDEMPOTENCY: CREATE OR REPLACE FUNCTION. Safe to re-apply.

CREATE OR REPLACE FUNCTION public.hor_reopen_month(
  p_tenant_id       uuid,
  p_subject_user_id uuid,
  p_year            integer,
  p_month           integer,
  p_note            text DEFAULT NULL
)
RETURNS public.hor_month_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_caller_tier  text;
  v_approver     text;
  v_existing     text;
  v_row          public.hor_month_status;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  SELECT tm.permission_tier INTO v_caller_tier
  FROM public.tenant_members tm
  WHERE tm.user_id = v_uid AND tm.tenant_id = p_tenant_id AND tm.active = true
  LIMIT 1;
  IF v_caller_tier IS NULL THEN
    RAISE EXCEPTION 'You are not an active member of this vessel.';
  END IF;

  SELECT s.approver_tier INTO v_approver
  FROM public._hor_vessel_settings(p_tenant_id) s;
  v_approver := COALESCE(v_approver, 'COMMAND');

  IF v_caller_tier <> 'COMMAND' AND v_caller_tier <> v_approver THEN
    RAISE EXCEPTION 'Your role (%) may not reopen HOR months on this vessel.', v_caller_tier;
  END IF;

  SELECT status INTO v_existing
  FROM public.hor_month_status
  WHERE tenant_id = p_tenant_id AND subject_user_id = p_subject_user_id
    AND period_year = p_year AND period_month = p_month;

  IF v_existing IS NULL OR v_existing NOT IN ('submitted', 'confirmed', 'locked') THEN
    RAISE EXCEPTION 'Cannot reopen: month is %, expected submitted, confirmed or locked.',
      COALESCE(v_existing, 'open');
  END IF;

  UPDATE public.hor_month_status
    SET status                 = 'open',
        submitted_at           = NULL, submitted_by = NULL,
        confirmed_at           = NULL, confirmed_by = NULL,
        locked_at              = NULL, locked_by = NULL,
        submit_signature_path  = NULL, submit_signed_name = NULL,
        submit_signed_ip       = NULL, submit_signed_ua = NULL,
        approve_signature_path = NULL, approve_signed_name = NULL,
        approve_signed_ip      = NULL, approve_signed_ua = NULL,
        note                   = COALESCE(p_note, note),
        updated_at             = now()
  WHERE tenant_id = p_tenant_id AND subject_user_id = p_subject_user_id
    AND period_year = p_year AND period_month = p_month
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.hor_reopen_month(uuid, uuid, integer, integer, text) TO authenticated;

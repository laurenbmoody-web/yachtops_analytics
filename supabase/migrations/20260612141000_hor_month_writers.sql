-- ─────────────────────────────────────────────────────────────────────────────
-- 20260612141000_hor_month_writers.sql
--
-- WHAT: SECURITY DEFINER writer RPCs for the HOR month state machine declared in
--       _140000. One writer per transition; each validates the caller, enforces
--       the legal source state, and stamps the actor/time atomically.
--
--         hor_submit_month   crew submits THEIR OWN month.
--                            mode='trust'  → straight to 'confirmed'.
--                            mode='require'→ 'submitted' (awaits approver).
--         hor_approve_month  approver confirms a 'submitted' month → 'confirmed'.
--         hor_reopen_month   approver returns 'submitted'|'confirmed' → 'open'
--                            (clears the submit/confirm stamps).
--         hor_lock_month     COMMAND locks a 'confirmed' month → 'locked'.
--
--       Authorisation: submit is self-only (subject = auth.uid()); approve/reopen
--       require permission_tier = vessel.hor_approver_tier OR COMMAND (always);
--       lock is COMMAND-only. All callers must be ACTIVE members of p_tenant_id.
--
-- WHY SECURITY DEFINER: the status table denies direct writes (RLS, _140000) so
--       the state machine + auth checks can only be exercised here, atomically.
--
-- IDEMPOTENCY: CREATE OR REPLACE FUNCTION. Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper: resolve the tenant's HOR settings. The vessels table is keyed by
-- tenant_id (one row per tenant — the active tenant IS its vessel), so we look
-- it up by tenant_id; there is no separate vessels.id in the live schema.
CREATE OR REPLACE FUNCTION public._hor_vessel_settings(p_tenant_id uuid)
RETURNS TABLE (mode text, approver_tier text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(v.hor_confirmation_mode, 'require'),
         COALESCE(v.hor_approver_tier, 'COMMAND')
  FROM public.vessels v
  WHERE v.tenant_id = p_tenant_id
  LIMIT 1;
$$;

-- ── submit (self) ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hor_submit_month(
  p_tenant_id uuid,
  p_year      integer,
  p_month     integer,
  p_note      text DEFAULT NULL,
  p_hash      text DEFAULT NULL
)
RETURNS public.hor_month_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_mode       text;
  v_tier       text;  -- approver tier (unused on submit, fetched together)
  v_existing   text;
  v_target     text;
  v_row        public.hor_month_status;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;
  IF NOT public.is_active_tenant_member(p_tenant_id, v_uid) THEN
    RAISE EXCEPTION 'You are not an active member of this vessel.';
  END IF;

  SELECT s.mode, s.approver_tier
    INTO v_mode, v_tier
  FROM public._hor_vessel_settings(p_tenant_id) s;
  v_mode := COALESCE(v_mode, 'require');

  SELECT status INTO v_existing
  FROM public.hor_month_status
  WHERE tenant_id = p_tenant_id AND subject_user_id = v_uid
    AND period_year = p_year AND period_month = p_month;

  IF v_existing = 'locked' THEN
    RAISE EXCEPTION 'This month is locked and can no longer be submitted.';
  END IF;

  -- trust mode skips the approver: submit confirms in one step.
  v_target := CASE WHEN v_mode = 'trust' THEN 'confirmed' ELSE 'submitted' END;

  INSERT INTO public.hor_month_status AS h (
    tenant_id, subject_user_id, period_year, period_month,
    status, note, dataset_version_hash,
    submitted_at, submitted_by,
    confirmed_at, confirmed_by, updated_at
  ) VALUES (
    p_tenant_id, v_uid, p_year, p_month,
    v_target, p_note, p_hash,
    now(), v_uid,
    CASE WHEN v_target = 'confirmed' THEN now() ELSE NULL END,
    CASE WHEN v_target = 'confirmed' THEN v_uid ELSE NULL END, now()
  )
  ON CONFLICT (tenant_id, subject_user_id, period_year, period_month)
  DO UPDATE SET
    status               = v_target,
    note                 = COALESCE(EXCLUDED.note, h.note),
    dataset_version_hash = COALESCE(EXCLUDED.dataset_version_hash, h.dataset_version_hash),
    submitted_at         = now(),
    submitted_by         = v_uid,
    confirmed_at         = CASE WHEN v_target = 'confirmed' THEN now()  ELSE NULL END,
    confirmed_by         = CASE WHEN v_target = 'confirmed' THEN v_uid ELSE NULL END,
    updated_at           = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- ── approve (approver tier / COMMAND) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hor_approve_month(
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
    RAISE EXCEPTION 'Your role (%) may not approve HOR months on this vessel.', v_caller_tier;
  END IF;

  SELECT status INTO v_existing
  FROM public.hor_month_status
  WHERE tenant_id = p_tenant_id AND subject_user_id = p_subject_user_id
    AND period_year = p_year AND period_month = p_month;

  IF v_existing IS NULL THEN
    RAISE EXCEPTION 'No HOR month to approve (crew has not submitted).' USING ERRCODE = 'P0002';
  END IF;
  IF v_existing <> 'submitted' THEN
    RAISE EXCEPTION 'Cannot approve: month is %, expected submitted.', v_existing;
  END IF;

  UPDATE public.hor_month_status
    SET status       = 'confirmed',
        confirmed_at = now(),
        confirmed_by = v_uid,
        note         = COALESCE(p_note, note),
        updated_at   = now()
  WHERE tenant_id = p_tenant_id AND subject_user_id = p_subject_user_id
    AND period_year = p_year AND period_month = p_month
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- ── reopen (approver tier / COMMAND) ─────────────────────────────────────────
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

  IF v_existing IS NULL OR v_existing NOT IN ('submitted', 'confirmed') THEN
    RAISE EXCEPTION 'Cannot reopen: month is %, expected submitted or confirmed.',
      COALESCE(v_existing, 'open');
  END IF;

  UPDATE public.hor_month_status
    SET status       = 'open',
        submitted_at = NULL, submitted_by = NULL,
        confirmed_at = NULL, confirmed_by = NULL,
        note         = COALESCE(p_note, note),
        updated_at   = now()
  WHERE tenant_id = p_tenant_id AND subject_user_id = p_subject_user_id
    AND period_year = p_year AND period_month = p_month
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- ── lock (COMMAND only) ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hor_lock_month(
  p_tenant_id       uuid,
  p_subject_user_id uuid,
  p_year            integer,
  p_month           integer
)
RETURNS public.hor_month_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_caller_tier  text;
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
  IF v_caller_tier <> 'COMMAND' THEN
    RAISE EXCEPTION 'Only COMMAND may lock HOR months.';
  END IF;

  SELECT status INTO v_existing
  FROM public.hor_month_status
  WHERE tenant_id = p_tenant_id AND subject_user_id = p_subject_user_id
    AND period_year = p_year AND period_month = p_month;

  IF v_existing <> 'confirmed' THEN
    RAISE EXCEPTION 'Cannot lock: month is %, expected confirmed.', COALESCE(v_existing, 'open');
  END IF;

  UPDATE public.hor_month_status
    SET status     = 'locked',
        locked_at  = now(),
        locked_by  = v_uid,
        updated_at = now()
  WHERE tenant_id = p_tenant_id AND subject_user_id = p_subject_user_id
    AND period_year = p_year AND period_month = p_month
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public._hor_vessel_settings(uuid)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.hor_submit_month(uuid, integer, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hor_approve_month(uuid, uuid, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hor_reopen_month(uuid, uuid, integer, integer, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.hor_lock_month(uuid, uuid, integer, integer)          TO authenticated;

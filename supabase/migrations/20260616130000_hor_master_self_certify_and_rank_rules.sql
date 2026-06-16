-- ─────────────────────────────────────────────────────────────────────────────
-- 20260616130000_hor_master_self_certify_and_rank_rules.sql
--
-- WHAT: Make HOR month sign-off rank-aware and add a month-end guard.
--   1. A month can only be signed off once it has fully ended (no certifying
--      rest for days that haven't happened yet).
--   2. Approval is rank-aware: an approver must be of EQUAL-OR-HIGHER rank than
--      the subject AND at/above the vessel's approver tier, and may not approve
--      their own month. (No junior countersigning a senior.)
--   3. The top of the chain self-certifies: if no other active member is of
--      sufficient rank to approve the subject, submit confirms in one step with
--      the submitter's single signature (e.g. the Master, when sole Command) —
--      mirroring maritime practice where the Master certifies their own record
--      and the company / DPA reviews ashore.
--
-- IDEMPOTENT: CREATE OR REPLACE (9-arg signatures unchanged from _120000).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── submit (self) — month-end guard + self-certify for top of chain ──────────
CREATE OR REPLACE FUNCTION public.hor_submit_month(
  p_tenant_id   uuid,
  p_year        integer,
  p_month       integer,
  p_note        text DEFAULT NULL,
  p_hash        text DEFAULT NULL,
  p_sig_path    text DEFAULT NULL,
  p_signed_name text DEFAULT NULL,
  p_signed_ip   text DEFAULT NULL,
  p_signed_ua   text DEFAULT NULL
)
RETURNS public.hor_month_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid           uuid := auth.uid();
  v_mode          text;
  v_tier          text;
  v_existing      text;
  v_target        text;
  v_last_day      date;
  v_subject_rank  int;
  v_approver_rank int;
  v_required_rank int;
  v_eligible      boolean;
  v_row           public.hor_month_status;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;
  IF NOT public.is_active_tenant_member(p_tenant_id, v_uid) THEN
    RAISE EXCEPTION 'You are not an active member of this vessel.';
  END IF;

  -- The month must have fully elapsed before it can be signed off.
  v_last_day := (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date;
  IF v_last_day > current_date THEN
    RAISE EXCEPTION 'This month has not finished yet; sign-off opens once it ends.';
  END IF;

  SELECT s.mode, s.approver_tier INTO v_mode, v_tier
  FROM public._hor_vessel_settings(p_tenant_id) s;
  v_mode := COALESCE(v_mode, 'require');
  v_tier := COALESCE(v_tier, 'COMMAND');

  -- Required approver rank = max(subject's own rank, vessel approver tier).
  SELECT public._hor_tier_rank(tm.permission_tier) INTO v_subject_rank
  FROM public.tenant_members tm
  WHERE tm.user_id = v_uid AND tm.tenant_id = p_tenant_id AND tm.active = true
  LIMIT 1;
  v_subject_rank  := COALESCE(v_subject_rank, 0);
  v_approver_rank := public._hor_tier_rank(v_tier);
  v_required_rank := GREATEST(v_subject_rank, v_approver_rank);

  -- Is there ANOTHER active member who could approve this subject?
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id AND tm.active = true AND tm.user_id <> v_uid
      AND public._hor_tier_rank(tm.permission_tier) >= v_required_rank
  ) INTO v_eligible;

  SELECT status INTO v_existing
  FROM public.hor_month_status
  WHERE tenant_id = p_tenant_id AND subject_user_id = v_uid
    AND period_year = p_year AND period_month = p_month;

  IF v_existing = 'locked' THEN
    RAISE EXCEPTION 'This month is locked and can no longer be submitted.';
  END IF;

  -- Trust mode OR top-of-chain with no eligible approver → self-certify.
  v_target := CASE WHEN v_mode = 'trust' OR NOT v_eligible THEN 'confirmed' ELSE 'submitted' END;

  INSERT INTO public.hor_month_status AS h (
    tenant_id, subject_user_id, period_year, period_month,
    status, note, dataset_version_hash,
    submitted_at, submitted_by,
    submit_signature_path, submit_signed_name, submit_signed_ip, submit_signed_ua,
    confirmed_at, confirmed_by, updated_at
  ) VALUES (
    p_tenant_id, v_uid, p_year, p_month,
    v_target, p_note, p_hash,
    now(), v_uid,
    p_sig_path, p_signed_name, p_signed_ip, p_signed_ua,
    CASE WHEN v_target = 'confirmed' THEN now() ELSE NULL END,
    CASE WHEN v_target = 'confirmed' THEN v_uid ELSE NULL END, now()
  )
  ON CONFLICT (tenant_id, subject_user_id, period_year, period_month)
  DO UPDATE SET
    status                = v_target,
    note                  = COALESCE(EXCLUDED.note, h.note),
    dataset_version_hash  = COALESCE(EXCLUDED.dataset_version_hash, h.dataset_version_hash),
    submitted_at          = now(),
    submitted_by          = v_uid,
    submit_signature_path = COALESCE(EXCLUDED.submit_signature_path, h.submit_signature_path),
    submit_signed_name    = COALESCE(EXCLUDED.submit_signed_name, h.submit_signed_name),
    submit_signed_ip      = COALESCE(EXCLUDED.submit_signed_ip, h.submit_signed_ip),
    submit_signed_ua      = COALESCE(EXCLUDED.submit_signed_ua, h.submit_signed_ua),
    confirmed_at          = CASE WHEN v_target = 'confirmed' THEN now()  ELSE NULL END,
    confirmed_by          = CASE WHEN v_target = 'confirmed' THEN v_uid ELSE NULL END,
    updated_at            = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- ── approve — rank-aware, no self-approval, no junior over senior ─────────────
CREATE OR REPLACE FUNCTION public.hor_approve_month(
  p_tenant_id       uuid,
  p_subject_user_id uuid,
  p_year            integer,
  p_month           integer,
  p_note            text DEFAULT NULL,
  p_sig_path        text DEFAULT NULL,
  p_signed_name     text DEFAULT NULL,
  p_signed_ip       text DEFAULT NULL,
  p_signed_ua       text DEFAULT NULL
)
RETURNS public.hor_month_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid           uuid := auth.uid();
  v_caller_tier   text;
  v_approver      text;
  v_existing      text;
  v_caller_rank   int;
  v_subject_rank  int;
  v_required_rank int;
  v_row           public.hor_month_status;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF v_uid = p_subject_user_id THEN
    RAISE EXCEPTION 'You cannot approve your own Hours of Rest.';
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

  SELECT public._hor_tier_rank(tm.permission_tier) INTO v_subject_rank
  FROM public.tenant_members tm
  WHERE tm.user_id = p_subject_user_id AND tm.tenant_id = p_tenant_id AND tm.active = true
  LIMIT 1;
  v_subject_rank  := COALESCE(v_subject_rank, 0);
  v_caller_rank   := public._hor_tier_rank(v_caller_tier);
  v_required_rank := GREATEST(v_subject_rank, public._hor_tier_rank(v_approver));

  -- Approver must be at/above the vessel tier AND not outranked by the subject.
  IF v_caller_rank < v_required_rank THEN
    RAISE EXCEPTION 'Your role (%) may not approve this crew member''s Hours of Rest.', v_caller_tier;
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
    SET status                 = 'confirmed',
        confirmed_at           = now(),
        confirmed_by           = v_uid,
        approve_signature_path = COALESCE(p_sig_path, approve_signature_path),
        approve_signed_name    = COALESCE(p_signed_name, approve_signed_name),
        approve_signed_ip      = COALESCE(p_signed_ip, approve_signed_ip),
        approve_signed_ua      = COALESCE(p_signed_ua, approve_signed_ua),
        note                   = COALESCE(p_note, note),
        updated_at             = now()
  WHERE tenant_id = p_tenant_id AND subject_user_id = p_subject_user_id
    AND period_year = p_year AND period_month = p_month
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.hor_submit_month(uuid, integer, integer, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hor_approve_month(uuid, uuid, integer, integer, text, text, text, text, text) TO authenticated;

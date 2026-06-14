-- ─────────────────────────────────────────────────────────────────────────────
-- 20260614190000_hor_approver_tier_hierarchy.sql
--
-- WHAT: Make HOR approval HIERARCHICAL. The vessel's hor_approver_tier is a
--       MINIMUM rank — any equal-or-higher rank may also approve/sign off
--       (COMMAND > CHIEF > HOD). Previously the check was exact-match-or-COMMAND,
--       so e.g. with approver_tier = 'HOD' a CHIEF was wrongly blocked.
--
--       Re-defines the three breach-reason writers from 20260613110000 with a
--       rank comparison via the new _hor_tier_rank() helper. Behaviour is
--       unchanged when approver_tier = 'COMMAND' (the default).
-- IDEMPOTENT: CREATE OR REPLACE throughout.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._hor_tier_rank(p_tier text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE upper(coalesce(p_tier, ''))
    WHEN 'COMMAND' THEN 3
    WHEN 'CHIEF'   THEN 2
    WHEN 'HOD'     THEN 1
    ELSE 0
  END;
$$;

-- ── upsert (crew self OR an approver of sufficient rank) ─────────────────────
CREATE OR REPLACE FUNCTION public.hor_upsert_breach_reason(
  p_tenant_id       uuid,
  p_subject_user_id uuid,
  p_breach_date     date,
  p_breach_types    text[],
  p_note            text
)
RETURNS public.hor_breach_reasons
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_caller_tier text;
  v_approver    text;
  v_is_subject  boolean := (auth.uid() = p_subject_user_id);
  v_row         public.hor_breach_reasons;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;
  IF p_note IS NULL OR length(btrim(p_note)) = 0 THEN
    RAISE EXCEPTION 'A breach reason is required.';
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

  -- Crew may record their own; otherwise the caller must be at or above the
  -- vessel's approver tier (higher ranks inherit lower ranks' authority).
  IF NOT v_is_subject
     AND public._hor_tier_rank(v_caller_tier) < public._hor_tier_rank(v_approver) THEN
    RAISE EXCEPTION 'You may not record a breach reason for another crew member.';
  END IF;

  INSERT INTO public.hor_breach_reasons AS h (
    tenant_id, subject_user_id, breach_date, breach_types, note_text,
    created_by, updated_by, updated_at
  ) VALUES (
    p_tenant_id, p_subject_user_id, p_breach_date,
    COALESCE(p_breach_types, '{}'), p_note,
    v_uid, v_uid, now()
  )
  ON CONFLICT (tenant_id, subject_user_id, breach_date)
  DO UPDATE SET
    breach_types  = COALESCE(EXCLUDED.breach_types, h.breach_types),
    note_text     = EXCLUDED.note_text,
    updated_by    = v_uid,
    updated_at    = now(),
    signed_off_by = CASE WHEN h.note_text IS DISTINCT FROM EXCLUDED.note_text
                         THEN NULL ELSE h.signed_off_by END,
    signed_off_at = CASE WHEN h.note_text IS DISTINCT FROM EXCLUDED.note_text
                         THEN NULL ELSE h.signed_off_at END
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- ── sign off (approver of sufficient rank) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.hor_sign_off_breach_reason(
  p_tenant_id       uuid,
  p_subject_user_id uuid,
  p_breach_date     date
)
RETURNS public.hor_breach_reasons
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_caller_tier text;
  v_approver    text;
  v_row         public.hor_breach_reasons;
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

  IF public._hor_tier_rank(v_caller_tier) < public._hor_tier_rank(v_approver) THEN
    RAISE EXCEPTION 'Your role (%) may not sign off breach reasons on this vessel.', v_caller_tier;
  END IF;

  UPDATE public.hor_breach_reasons
    SET signed_off_by = v_uid,
        signed_off_at = now(),
        updated_at    = now()
  WHERE tenant_id = p_tenant_id AND subject_user_id = p_subject_user_id
    AND breach_date = p_breach_date
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'No breach reason to sign off for that date.' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_row;
END;
$function$;

-- ── unsign (approver of sufficient rank) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hor_unsign_breach_reason(
  p_tenant_id       uuid,
  p_subject_user_id uuid,
  p_breach_date     date
)
RETURNS public.hor_breach_reasons
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_caller_tier text;
  v_approver    text;
  v_row         public.hor_breach_reasons;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  SELECT tm.permission_tier INTO v_caller_tier
  FROM public.tenant_members tm
  WHERE tm.user_id = v_uid AND tm.tenant_id = p_tenant_id AND tm.active = true
  LIMIT 1;

  SELECT s.approver_tier INTO v_approver
  FROM public._hor_vessel_settings(p_tenant_id) s;
  v_approver := COALESCE(v_approver, 'COMMAND');

  IF v_caller_tier IS NULL
     OR public._hor_tier_rank(v_caller_tier) < public._hor_tier_rank(v_approver) THEN
    RAISE EXCEPTION 'Your role may not change breach sign-offs on this vessel.';
  END IF;

  UPDATE public.hor_breach_reasons
    SET signed_off_by = NULL,
        signed_off_at = NULL,
        updated_at    = now()
  WHERE tenant_id = p_tenant_id AND subject_user_id = p_subject_user_id
    AND breach_date = p_breach_date
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public._hor_tier_rank(text)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.hor_upsert_breach_reason(uuid, uuid, date, text[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hor_sign_off_breach_reason(uuid, uuid, date)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.hor_unsign_breach_reason(uuid, uuid, date)    TO authenticated;

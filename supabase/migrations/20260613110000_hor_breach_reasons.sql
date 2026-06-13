-- ─────────────────────────────────────────────────────────────────────────────
-- 20260613110000_hor_breach_reasons.sql
--
-- WHAT: DB-backed HOR breach reasons + command sign-off (Phase 4) — replaces the
--       per-device localStorage 'cargo_hor_breach_notes' store and adds the
--       regulatory sign-off step the localStorage version lacked.
--
--       One row per (tenant, crew member, breach date): the documented reason
--       for the MLC rest breach on that day, plus an approver sign-off stamp.
--
--       Writers (SECURITY DEFINER, companion to the table — direct writes denied
--       by RLS so the auth checks can only run here):
--         hor_upsert_breach_reason   crew records their own reason, OR an
--                                    approver records one on their behalf.
--                                    Editing the note clears any prior sign-off
--                                    (the changed text must be re-signed).
--         hor_sign_off_breach_reason approver (vessel.hor_approver_tier or
--                                    COMMAND) signs off a recorded reason.
--         hor_unsign_breach_reason   approver clears a sign-off (correction).
--
-- IDEMPOTENCY: CREATE TABLE/POLICY IF NOT EXISTS + CREATE OR REPLACE FUNCTION.
--       Depends on _hor_vessel_settings (20260612141000) for the approver tier.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hor_breach_reasons (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Crew member the breach belongs to (profiles.id / auth user id — the
  -- crew-profile route id, NOT tenant_members.id).
  subject_user_id uuid NOT NULL,
  breach_date     date NOT NULL,
  breach_types    text[] NOT NULL DEFAULT '{}',   -- MLC rule codes breached that day
  note_text       text NOT NULL,
  created_by      uuid,
  updated_by      uuid,
  signed_off_by   uuid,
  signed_off_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hor_breach_reasons_unique
    UNIQUE (tenant_id, subject_user_id, breach_date)
);

CREATE INDEX IF NOT EXISTS hor_breach_reasons_subject_idx
  ON public.hor_breach_reasons (tenant_id, subject_user_id, breach_date);

ALTER TABLE public.hor_breach_reasons ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'hor_breach_reasons'
      AND policyname = 'hor_breach_reasons_read'
  ) THEN
    CREATE POLICY "hor_breach_reasons_read"
      ON public.hor_breach_reasons
      FOR SELECT
      USING (public.is_active_tenant_member(tenant_id, auth.uid()));
  END IF;
END $$;

-- ── upsert (crew self OR approver) ───────────────────────────────────────────
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

  -- The crew member may record their own; an approver/COMMAND may record any.
  IF NOT v_is_subject AND v_caller_tier <> 'COMMAND' AND v_caller_tier <> v_approver THEN
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
    -- Edited reason text invalidates a prior sign-off — it must be re-signed.
    signed_off_by = CASE WHEN h.note_text IS DISTINCT FROM EXCLUDED.note_text
                         THEN NULL ELSE h.signed_off_by END,
    signed_off_at = CASE WHEN h.note_text IS DISTINCT FROM EXCLUDED.note_text
                         THEN NULL ELSE h.signed_off_at END
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- ── sign off (approver tier / COMMAND) ───────────────────────────────────────
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

  IF v_caller_tier <> 'COMMAND' AND v_caller_tier <> v_approver THEN
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

-- ── unsign (approver tier / COMMAND) ─────────────────────────────────────────
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

  IF v_caller_tier IS NULL OR (v_caller_tier <> 'COMMAND' AND v_caller_tier <> v_approver) THEN
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

GRANT EXECUTE ON FUNCTION public.hor_upsert_breach_reason(uuid, uuid, date, text[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hor_sign_off_breach_reason(uuid, uuid, date)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.hor_unsign_breach_reason(uuid, uuid, date)                TO authenticated;

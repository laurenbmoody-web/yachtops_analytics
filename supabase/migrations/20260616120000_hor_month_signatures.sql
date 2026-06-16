-- ─────────────────────────────────────────────────────────────────────────────
-- 20260616120000_hor_month_signatures.sql
--
-- WHAT: Electronic signature capture for the HOR month workflow (_140000 /
--       _141000). Each transition that puts a name to the record now carries a
--       drawn-signature image + an audit trail (signed name, IP, user agent);
--       the actor + server timestamp are already on the row (submitted_by/at,
--       confirmed_by/at).
--
--         submit  → crew member's signature  (submit_signature_*)
--         approve → captain's counter-sign   (approve_signature_*)
--
--       The drawn signature is a PNG in the private 'hor-signatures' storage
--       bucket; the DB stores the object PATH (re-signed on display, so the
--       record stays valid past any signed-URL expiry), not a baked-in URL.
--
--       The submit/approve writer RPCs are re-created with optional signature
--       params appended (NULL-safe: trust-mode auto-confirm and reopen flows
--       that carry no signature still work).
--
-- IDEMPOTENCY: ADD COLUMN IF NOT EXISTS + bucket ON CONFLICT DO NOTHING +
--       DROP/CREATE POLICY + CREATE OR REPLACE FUNCTION. Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Signature + audit columns on the month status row ────────────────────────
ALTER TABLE public.hor_month_status
  ADD COLUMN IF NOT EXISTS submit_signature_path  text,
  ADD COLUMN IF NOT EXISTS submit_signed_name     text,
  ADD COLUMN IF NOT EXISTS submit_signed_ip       text,
  ADD COLUMN IF NOT EXISTS submit_signed_ua       text,
  ADD COLUMN IF NOT EXISTS approve_signature_path text,
  ADD COLUMN IF NOT EXISTS approve_signed_name    text,
  ADD COLUMN IF NOT EXISTS approve_signed_ip      text,
  ADD COLUMN IF NOT EXISTS approve_signed_ua      text;

COMMENT ON COLUMN public.hor_month_status.submit_signature_path IS
  'storage path (hor-signatures bucket) of the crew member''s drawn signature at submit.';
COMMENT ON COLUMN public.hor_month_status.approve_signature_path IS
  'storage path (hor-signatures bucket) of the captain''s drawn counter-signature at approve.';

-- ── Private signature bucket ─────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'hor-signatures',
  'hor-signatures',
  false,                       -- private; reads go through signed URLs
  524288,                      -- 512KB — a drawn signature PNG is tiny
  ARRAY['image/png']
)
ON CONFLICT (id) DO NOTHING;

-- Each user writes signatures into their OWN {auth.uid()}/ folder. The DB row
-- links a signature to its subject month, so the folder need not be the subject.
DROP POLICY IF EXISTS "users_manage_own_hor_signatures" ON storage.objects;
CREATE POLICY "users_manage_own_hor_signatures"
ON storage.objects
FOR ALL
TO authenticated
USING (
  bucket_id = 'hor-signatures'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'hor-signatures'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Tenant members may view each other's signatures (so a captain sees the crew's
-- signature and the crew sees the captain's counter-sign on the record).
DROP POLICY IF EXISTS "users_view_tenant_hor_signatures" ON storage.objects;
CREATE POLICY "users_view_tenant_hor_signatures"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'hor-signatures'
  AND EXISTS (
    SELECT 1 FROM public.tenant_members tm1
    JOIN public.tenant_members tm2 ON tm1.tenant_id = tm2.tenant_id
    WHERE tm1.user_id = auth.uid()
      AND tm2.user_id = (storage.foldername(name))[1]::uuid
      AND tm1.active = true
      AND tm2.active = true
  )
);

-- ── submit (self) — now captures the crew member's signature ─────────────────
DROP FUNCTION IF EXISTS public.hor_submit_month(uuid, integer, integer, text, text);
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

-- ── approve (approver tier / COMMAND) — captures the counter-signature ───────
DROP FUNCTION IF EXISTS public.hor_approve_month(uuid, uuid, integer, integer, text);
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

-- reopen clears the approver's counter-signature along with the confirm stamp
-- (the returned-to-open month must be re-approved + re-signed).
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
    SET status                 = 'open',
        submitted_at           = NULL, submitted_by = NULL,
        confirmed_at           = NULL, confirmed_by = NULL,
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

GRANT EXECUTE ON FUNCTION public.hor_submit_month(uuid, integer, integer, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hor_approve_month(uuid, uuid, integer, integer, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hor_reopen_month(uuid, uuid, integer, integer, text)                          TO authenticated;

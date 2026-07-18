-- ─────────────────────────────────────────────────────────────────────────────
-- 20260718150000_laundry_case_shares.sql
--
-- Guest-facing share links for a laundry case. A crew member mints a link for a
-- case and sets a secret (the guest's surname); the guest opens /case/<token>,
-- enters the surname, and sees that case's contents (items, care, status) — no
-- login. Two factors: the unguessable token AND the surname, so a leaked link
-- alone reveals nothing.
--
-- The table is never exposed to `anon`; all public access is through two
-- SECURITY DEFINER RPCs — mint (authenticated crew) and fetch (anon, gated on
-- token + secret). The secret is stored only as a SHA-256 hash.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.laundry_case_shares (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  case_id          uuid NOT NULL REFERENCES public.laundry_cases(id) ON DELETE CASCADE,
  token            text UNIQUE NOT NULL DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  secret_hash      text NOT NULL,
  expires_at       timestamptz,
  revoked          boolean NOT NULL DEFAULT false,
  created_by       uuid REFERENCES auth.users(id),
  created_by_name  text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS laundry_case_shares_case_idx ON public.laundry_case_shares (case_id);

ALTER TABLE public.laundry_case_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_members_manage_case_shares" ON public.laundry_case_shares;
CREATE POLICY "tenant_members_manage_case_shares"
  ON public.laundry_case_shares FOR ALL TO authenticated
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

-- Mint a share link for a case (crew only). Returns the token.
CREATE OR REPLACE FUNCTION public.create_laundry_case_share(p_case_id uuid, p_secret text, p_expires_at timestamptz DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant uuid;
  v_token  text;
  v_name   text;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.laundry_cases WHERE id = p_case_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'case not found'; END IF;
  IF NOT public.is_tenant_member(v_tenant) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF coalesce(btrim(p_secret), '') = '' THEN RAISE EXCEPTION 'secret required'; END IF;

  SELECT coalesce(raw_user_meta_data->>'full_name', email) INTO v_name FROM auth.users WHERE id = auth.uid();

  INSERT INTO public.laundry_case_shares (tenant_id, case_id, secret_hash, expires_at, created_by, created_by_name)
  VALUES (v_tenant, p_case_id, encode(digest(lower(btrim(p_secret)), 'sha256'), 'hex'), p_expires_at, auth.uid(), v_name)
  RETURNING token INTO v_token;

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.create_laundry_case_share(uuid, text, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_laundry_case_share(uuid, text, timestamptz) TO authenticated;

-- Public read: token + secret (surname) returns the case contents. No auth.
CREATE OR REPLACE FUNCTION public.fetch_laundry_case_share(p_token text, p_secret text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_share public.laundry_case_shares;
  v_case  public.laundry_cases;
  v_items jsonb;
BEGIN
  SELECT * INTO v_share FROM public.laundry_case_shares WHERE token = p_token;
  IF v_share.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF v_share.revoked THEN RETURN jsonb_build_object('ok', false, 'reason', 'revoked'); END IF;
  IF v_share.expires_at IS NOT NULL AND v_share.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  IF v_share.secret_hash <> encode(digest(lower(btrim(coalesce(p_secret, ''))), 'sha256'), 'hex') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'secret');
  END IF;

  SELECT * INTO v_case FROM public.laundry_cases WHERE id = v_share.case_id;
  IF v_case.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'description', li.description,
      'colour', li.colour,
      'tags', li.tags,
      'status', li.status
    ) ORDER BY li.created_at DESC), '[]'::jsonb)
  INTO v_items
  FROM public.laundry_items li
  WHERE li.case_id = v_case.id;

  RETURN jsonb_build_object(
    'ok', true,
    'case', jsonb_build_object('name', v_case.name, 'destination', v_case.destination, 'status', v_case.status),
    'items', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fetch_laundry_case_share(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fetch_laundry_case_share(text, text) TO anon, authenticated;

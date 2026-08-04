-- Cargo Accounts — how a management company gets access to a vessel.
--
-- The previous migration built what management CAN do. Nothing built how they
-- get on a boat in the first place, so the only way to create the row was by
-- hand in the database.
--
-- The grant is per vessel and made by that vessel's COMMAND. That direction
-- matters: the boat lets the office in, the office does not help itself. It also
-- means a company that manages six yachts gets six independent grants, any one
-- of which the boat can withdraw on its own — which is what happens when a
-- vessel changes management company. There is deliberately no fleet entity that
-- would let one relationship carry six boats with it.
--
-- Access is granted to an EMAIL, not to a user id, because the office is
-- routinely being invited before they have a Cargo login. The row sits pending
-- until someone signs in with that address and claims it. A pending row grants
-- nothing: is_management_member() matches on user_id, which is still null.

-- One table for both states — "who can see this vessel's month-end", whether or
-- not they've signed up yet. Two tables would mean the list COMMAND reads is a
-- union, and the pending half would be easy to forget when revoking.
ALTER TABLE public.management_members
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.management_members
  ADD COLUMN IF NOT EXISTS email      text,
  ADD COLUMN IF NOT EXISTS granted_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- A row has to identify somebody, one way or the other.
ALTER TABLE public.management_members
  DROP CONSTRAINT IF EXISTS management_members_identified;
ALTER TABLE public.management_members
  ADD CONSTRAINT management_members_identified
  CHECK (user_id IS NOT NULL OR email IS NOT NULL);

-- Case-insensitive, because an email typed by a captain and one typed at signup
-- will not match on case, and two rows for the same person is two revokes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_management_members_email
  ON public.management_members(tenant_id, lower(email)) WHERE email IS NOT NULL;

-- ── granting ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.grant_management_access(
  p_tenant_id uuid, p_email text, p_company_name text DEFAULT NULL
)
RETURNS public.management_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_email text; v_user uuid; r public.management_members;
BEGIN
  v_email := lower(btrim(coalesce(p_email, '')));
  IF v_email = '' OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'That does not look like an email address' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id AND tm.user_id = auth.uid()
      AND tm.active IS NOT FALSE AND tm.permission_tier = 'COMMAND'
  ) THEN
    RAISE EXCEPTION 'Only the vessel''s command can give management access' USING ERRCODE = '42501';
  END IF;

  -- Someone already in the crew must not be handed a second, read-only identity
  -- on the same boat: they'd see two vessels in the switcher, both this one.
  IF EXISTS (
    SELECT 1 FROM public.tenant_members tm
    JOIN auth.users u ON u.id = tm.user_id
    WHERE tm.tenant_id = p_tenant_id AND tm.active IS NOT FALSE AND lower(u.email) = v_email
  ) THEN
    RAISE EXCEPTION 'That address is already crew on this vessel' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_user FROM auth.users WHERE lower(email) = v_email LIMIT 1;

  -- Match on either identifier. Granting again after a withdrawal, or under the
  -- address someone has since changed, has to land on the row that already
  -- exists — a second row would mean two things to revoke and a unique
  -- violation the captain would have to read.
  SELECT * INTO r FROM public.management_members
   WHERE tenant_id = p_tenant_id
     AND (lower(email) = v_email OR (v_user IS NOT NULL AND user_id = v_user))
   LIMIT 1;

  IF FOUND THEN
    UPDATE public.management_members
       SET active = true,
           email = v_email,
           user_id = coalesce(v_user, user_id),
           company_name = coalesce(nullif(btrim(coalesce(p_company_name, '')), ''), company_name),
           claimed_at = CASE WHEN claimed_at IS NULL AND v_user IS NOT NULL THEN now() ELSE claimed_at END,
           updated_at = now()
     WHERE id = r.id
     RETURNING * INTO r;
    RETURN r;
  END IF;

  INSERT INTO public.management_members (user_id, tenant_id, email, company_name, invited_by, claimed_at)
  VALUES (v_user, p_tenant_id, v_email, nullif(btrim(coalesce(p_company_name, '')), ''), auth.uid(),
          CASE WHEN v_user IS NULL THEN NULL ELSE now() END)
  RETURNING * INTO r;

  RETURN r;
END;
$fn$;

-- ── claiming ─────────────────────────────────────────────────────────────────
-- Run when a session starts. A grant made before the person had a login is
-- inert until this attaches it to them — matching on the address the vessel was
-- given. No-op, and cheap, for everyone else.
CREATE OR REPLACE FUNCTION public.claim_management_access()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_email text; v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email IS NULL THEN RETURN 0; END IF;

  UPDATE public.management_members
     SET user_id = auth.uid(), claimed_at = now(), updated_at = now()
   WHERE user_id IS NULL AND active AND lower(email) = v_email;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

-- ── the vessel's own list ────────────────────────────────────────────────────
-- Deliberately not a plain SELECT on the table: it joins auth.users for a name,
-- which no client should be able to do for itself.
CREATE OR REPLACE FUNCTION public.list_management_access(p_tenant_id uuid)
RETURNS TABLE (
  id uuid, email text, company_name text, person_name text,
  active boolean, granted_at timestamptz, claimed_at timestamptz, has_login boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id AND tm.user_id = auth.uid()
      AND tm.active IS NOT FALSE AND tm.permission_tier = 'COMMAND'
  ) THEN
    RAISE EXCEPTION 'Not permitted' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT mm.id, mm.email, mm.company_name,
         coalesce(p.full_name, nullif(btrim(concat_ws(' ', p.first_name, p.surname)), '')),
         mm.active, mm.granted_at, mm.claimed_at, mm.user_id IS NOT NULL
  FROM public.management_members mm
  LEFT JOIN public.profiles p ON p.id = mm.user_id
  WHERE mm.tenant_id = p_tenant_id
  ORDER BY mm.active DESC, mm.granted_at DESC;
END;
$fn$;

-- ── withdrawing ──────────────────────────────────────────────────────────────
-- Deactivated rather than deleted: months they signed off carry their user id in
-- approved_by, and the vessel is entitled to know who signed what after the
-- relationship ends. Re-granting the same address reactivates this row.
CREATE OR REPLACE FUNCTION public.revoke_management_access(p_id uuid)
RETURNS public.management_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE r public.management_members;
BEGIN
  SELECT * INTO r FROM public.management_members WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such access' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = r.tenant_id AND tm.user_id = auth.uid()
      AND tm.active IS NOT FALSE AND tm.permission_tier = 'COMMAND'
  ) THEN
    RAISE EXCEPTION 'Only the vessel''s command can withdraw management access' USING ERRCODE = '42501';
  END IF;

  UPDATE public.management_members SET active = false, updated_at = now()
   WHERE id = p_id RETURNING * INTO r;
  RETURN r;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.grant_management_access(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_management_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_management_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_management_access(uuid) TO authenticated;

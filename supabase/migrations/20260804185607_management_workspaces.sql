-- Cargo — management companies as workspaces, mirroring the supplier side.
--
-- Access was granted to an EMAIL per vessel. That works, and it's how the office
-- would use it, but it has one weakness the whole feature exists to avoid: a
-- firm typically uses a shared mailbox, so six boats granting accounts@… means
-- one shared login, and a month signed off records the MAILBOX rather than the
-- person who signed it. The audit trail — the thing the owner might one day read
-- — goes soft exactly where it matters.
--
-- Suppliers in this app already solved this: supplier_profiles is a workspace,
-- supplier_contacts are its team with their own tiers, supplier_invites brings
-- people in. This is the same shape for the shore office, deliberately, so there
-- is one pattern in the codebase rather than two.
--
--   management_companies         the firm
--   management_company_members   its people, each with their own login
--   management_engagements       vessel ←→ firm, with the scopes that vessel gave
--
-- The trade this makes, stated plainly: the VESSEL controls the engagement and
-- what it covers; the FIRM controls who its people are. A new hire at the office
-- therefore reaches every vessel that engaged the firm, without six captains
-- re-granting. That is how engaging a management company actually works, and the
-- protection is that every action is stamped with the individual and the
-- vessel's own list shows the firm's current people by name.
--
-- management_members held no rows, so this restructures rather than migrates.

-- ── the firm ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.management_companies (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  active     boolean     NOT NULL DEFAULT true,
  created_by uuid        REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_management_companies_name
  ON public.management_companies(lower(name));

-- ── its people ───────────────────────────────────────────────────────────────
-- Same pending-by-email trick as before: a colleague can be added before they
-- have a Cargo login, and the row grants nothing until they claim it. That is
-- what keeps per-person identity affordable — adding someone is not a favour you
-- have to ask a captain for.
CREATE TABLE IF NOT EXISTS public.management_company_members (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.management_companies(id) ON DELETE CASCADE,
  user_id         uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  email           text        NOT NULL,
  permission_tier text        NOT NULL DEFAULT 'MEMBER'
                              CHECK (permission_tier IN ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER')),
  active          boolean     NOT NULL DEFAULT true,
  invited_by      uuid        REFERENCES auth.users(id),
  invited_at      timestamptz NOT NULL DEFAULT now(),
  claimed_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, email)
);
CREATE INDEX IF NOT EXISTS idx_mcm_user ON public.management_company_members(user_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_mcm_company ON public.management_company_members(company_id) WHERE active;

-- ── vessel ←→ firm ───────────────────────────────────────────────────────────
-- One row per engagement. Six yachts with the same firm is six rows: each boat
-- gave its own scopes and each can end its own engagement without asking the
-- other five.
CREATE TABLE IF NOT EXISTS public.management_engagements (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid        NOT NULL REFERENCES public.management_companies(id) ON DELETE CASCADE,
  scopes     text[]      NOT NULL DEFAULT ARRAY['accounts']::text[],
  active     boolean     NOT NULL DEFAULT true,
  granted_by uuid        REFERENCES auth.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id),
  CONSTRAINT management_engagements_scopes_known CHECK (
    scopes <@ ARRAY['accounts', 'hor', 'month_end']::text[]
    AND coalesce(array_length(scopes, 1), 0) >= 1
  )
);
CREATE INDEX IF NOT EXISTS idx_me_tenant ON public.management_engagements(tenant_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_me_company ON public.management_engagements(company_id) WHERE active;

DROP TRIGGER IF EXISTS set_management_companies_updated_at ON public.management_companies;
CREATE TRIGGER set_management_companies_updated_at BEFORE UPDATE ON public.management_companies
  FOR EACH ROW EXECUTE FUNCTION public.handle_account_reconciliations_updated_at();
DROP TRIGGER IF EXISTS set_mcm_updated_at ON public.management_company_members;
CREATE TRIGGER set_mcm_updated_at BEFORE UPDATE ON public.management_company_members
  FOR EACH ROW EXECUTE FUNCTION public.handle_account_reconciliations_updated_at();
DROP TRIGGER IF EXISTS set_me_updated_at ON public.management_engagements;
CREATE TRIGGER set_me_updated_at BEFORE UPDATE ON public.management_engagements
  FOR EACH ROW EXECUTE FUNCTION public.handle_account_reconciliations_updated_at();

-- No table-level access for anybody. Everything below is a SECURITY DEFINER
-- function that decides for itself, exactly as before — the workspace changes
-- who the office IS, not how little the database trusts them.
ALTER TABLE public.management_companies        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.management_company_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.management_engagements      ENABLE ROW LEVEL SECURITY;

-- ── the gates ────────────────────────────────────────────────────────────────
-- "Is there a relationship at all" — cheap, used to decide whether to draw a
-- management shell.
CREATE OR REPLACE FUNCTION public.is_management_member(p_tenant_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.management_engagements e
    JOIN public.management_company_members m ON m.company_id = e.company_id
    JOIN public.management_companies c ON c.id = e.company_id
    WHERE e.tenant_id = p_tenant_id AND e.active AND c.active
      AND m.user_id = p_user_id AND m.active
  );
$fn$;

-- "Can they see this part of it" — every function returning real data asks this.
CREATE OR REPLACE FUNCTION public.management_can(
  p_tenant_id uuid, p_scope text, p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.management_engagements e
    JOIN public.management_company_members m ON m.company_id = e.company_id
    JOIN public.management_companies c ON c.id = e.company_id
    WHERE e.tenant_id = p_tenant_id AND e.active AND c.active
      AND p_scope = ANY (e.scopes)
      AND m.user_id = p_user_id AND m.active
  );
$fn$;

-- "…and are they allowed to act on it". A VIEWER at the firm reads the month but
-- does not sign it off — juniors preparing the file for a director to approve is
-- the normal shape of an accounts office.
CREATE OR REPLACE FUNCTION public.management_can_write(
  p_tenant_id uuid, p_scope text, p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.management_engagements e
    JOIN public.management_company_members m ON m.company_id = e.company_id
    JOIN public.management_companies c ON c.id = e.company_id
    WHERE e.tenant_id = p_tenant_id AND e.active AND c.active
      AND p_scope = ANY (e.scopes)
      AND m.user_id = p_user_id AND m.active
      AND m.permission_tier <> 'VIEWER'
  );
$fn$;

-- Which firm is the caller acting for. Almost always exactly one.
CREATE OR REPLACE FUNCTION public.my_management_companies()
RETURNS TABLE (company_id uuid, company_name text, permission_tier text, vessels integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT c.id, c.name, m.permission_tier,
         (SELECT count(*)::int FROM public.management_engagements e
           WHERE e.company_id = c.id AND e.active)
  FROM public.management_company_members m
  JOIN public.management_companies c ON c.id = m.company_id
  WHERE m.user_id = auth.uid() AND m.active AND c.active
  ORDER BY c.name;
$fn$;

-- ── the two writes now check the acting tier ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.management_sign_off(p_reconciliation_id uuid, p_note text DEFAULT NULL)
RETURNS public.account_reconciliations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE r public.account_reconciliations;
BEGIN
  SELECT * INTO r FROM public.account_reconciliations WHERE id = p_reconciliation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That month is not on file' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.management_can_write(r.tenant_id, 'accounts') THEN
    RAISE EXCEPTION 'Not permitted' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'submitted' THEN
    RAISE EXCEPTION 'Only a month the vessel has closed can be signed off (this one is %)', r.status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.account_reconciliations
     SET status = 'approved', approved_by = auth.uid(), approved_at = now(),
         signoff_note = NULLIF(BTRIM(COALESCE(p_note, '')), ''),
         queried_at = NULL, queried_by = NULL, query_note = NULL
   WHERE id = p_reconciliation_id
   RETURNING * INTO r;
  RETURN r;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.management_query(p_reconciliation_id uuid, p_note text)
RETURNS public.account_reconciliations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE r public.account_reconciliations;
BEGIN
  IF COALESCE(BTRIM(p_note), '') = '' THEN
    RAISE EXCEPTION 'A query needs a reason' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.account_reconciliations WHERE id = p_reconciliation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That month is not on file' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.management_can_write(r.tenant_id, 'accounts') THEN
    RAISE EXCEPTION 'Not permitted' USING ERRCODE = '42501';
  END IF;
  IF r.status = 'open' THEN
    RAISE EXCEPTION 'That month is already back with the vessel' USING ERRCODE = '22023';
  END IF;

  UPDATE public.account_reconciliations
     SET status = 'open', submitted_at = NULL,
         approved_by = NULL, approved_at = NULL, signoff_note = NULL,
         queried_at = now(), queried_by = auth.uid(), query_note = BTRIM(p_note)
   WHERE id = p_reconciliation_id
   RETURNING * INTO r;
  RETURN r;
END;
$fn$;

-- ── the office's fleet ───────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.management_fleet();
CREATE OR REPLACE FUNCTION public.management_fleet()
RETURNS TABLE (
  tenant_id uuid, vessel_name text, company_id uuid, company_name text, scopes text[],
  awaiting_signoff integer, signed_off integer, queried integer, latest_period date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT
    e.tenant_id, t.name, c.id, c.name, e.scopes,
    COUNT(r.id) FILTER (WHERE r.status = 'submitted' AND 'accounts' = ANY (e.scopes))::int,
    COUNT(r.id) FILTER (WHERE r.status = 'approved' AND 'accounts' = ANY (e.scopes))::int,
    COUNT(r.id) FILTER (WHERE r.status = 'open' AND r.queried_at IS NOT NULL AND 'accounts' = ANY (e.scopes))::int,
    MAX(r.period_month) FILTER (WHERE 'accounts' = ANY (e.scopes))
  FROM public.management_engagements e
  JOIN public.management_companies c ON c.id = e.company_id AND c.active
  JOIN public.management_company_members m
    ON m.company_id = e.company_id AND m.user_id = auth.uid() AND m.active
  JOIN public.tenants t ON t.id = e.tenant_id
  LEFT JOIN public.account_reconciliations r ON r.tenant_id = e.tenant_id
  WHERE e.active
  GROUP BY e.tenant_id, t.name, c.id, c.name, e.scopes
  ORDER BY t.name;
$fn$;

-- ── the vessel engages a firm ────────────────────────────────────────────────
-- Same call the captain already makes: an address, the firm's name, the areas.
-- Underneath it now finds or creates the firm, makes that address its first
-- OWNER, and records the engagement. Everyone the firm subsequently adds
-- inherits the vessels the firm is engaged on — which is the point.
DROP FUNCTION IF EXISTS public.grant_management_access(uuid, text, text, text[]);
CREATE OR REPLACE FUNCTION public.grant_management_access(
  p_tenant_id uuid, p_email text, p_company_name text DEFAULT NULL,
  p_scopes text[] DEFAULT ARRAY['accounts']::text[]
)
RETURNS public.management_engagements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_email text; v_user uuid; v_scopes text[]; v_name text;
  v_company uuid; e public.management_engagements;
BEGIN
  v_email := lower(btrim(coalesce(p_email, '')));
  IF v_email = '' OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'That does not look like an email address' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT s ORDER BY s) INTO v_scopes
    FROM unnest(coalesce(p_scopes, ARRAY[]::text[])) s
   WHERE s = ANY (ARRAY['accounts', 'hor', 'month_end']::text[]);
  IF v_scopes IS NULL OR array_length(v_scopes, 1) = 0 THEN
    RAISE EXCEPTION 'Choose at least one thing they can see' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id AND tm.user_id = auth.uid()
      AND tm.active IS NOT FALSE AND tm.permission_tier = 'COMMAND'
  ) THEN
    RAISE EXCEPTION 'Only the vessel''s command can engage a management company' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tenant_members tm
    JOIN auth.users u ON u.id = tm.user_id
    WHERE tm.tenant_id = p_tenant_id AND tm.active IS NOT FALSE AND lower(u.email) = v_email
  ) THEN
    RAISE EXCEPTION 'That address is already crew on this vessel' USING ERRCODE = '22023';
  END IF;

  -- The address may already belong to a firm — the usual case once a company
  -- manages its second yacht. Then the captain is engaging THAT firm, and the
  -- name they typed is not allowed to fork it into a duplicate.
  SELECT m.company_id INTO v_company
    FROM public.management_company_members m
    JOIN public.management_companies c ON c.id = m.company_id AND c.active
   WHERE m.email = v_email AND m.active
   LIMIT 1;

  IF v_company IS NULL THEN
    v_name := nullif(btrim(coalesce(p_company_name, '')), '');
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'Name the management company so their team can be kept together' USING ERRCODE = '22023';
    END IF;
    SELECT id INTO v_company FROM public.management_companies WHERE lower(name) = lower(v_name);
    IF v_company IS NULL THEN
      INSERT INTO public.management_companies (name, created_by)
      VALUES (v_name, auth.uid()) RETURNING id INTO v_company;
    END IF;

    SELECT id INTO v_user FROM auth.users WHERE lower(email) = v_email LIMIT 1;
    INSERT INTO public.management_company_members
      (company_id, user_id, email, permission_tier, invited_by, claimed_at)
    VALUES (v_company, v_user, v_email, 'OWNER', auth.uid(),
            CASE WHEN v_user IS NULL THEN NULL ELSE now() END)
    ON CONFLICT (company_id, email) DO UPDATE SET active = true, updated_at = now();
  END IF;

  INSERT INTO public.management_engagements (tenant_id, company_id, scopes, granted_by)
  VALUES (p_tenant_id, v_company, v_scopes, auth.uid())
  ON CONFLICT (tenant_id, company_id)
  DO UPDATE SET active = true, scopes = excluded.scopes, updated_at = now()
  RETURNING * INTO e;

  RETURN e;
END;
$fn$;

-- What the vessel sees: the firms it has engaged, and who is currently at each.
-- The people matter — the boat gave access to a company, so it is entitled to
-- see, at any moment, exactly which humans that turned out to be.
DROP FUNCTION IF EXISTS public.list_management_access(uuid);
CREATE OR REPLACE FUNCTION public.list_management_access(p_tenant_id uuid)
RETURNS TABLE (
  id uuid, company_id uuid, company_name text, scopes text[],
  active boolean, granted_at timestamptz, people jsonb, people_count integer
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
  SELECT e.id, c.id, c.name, e.scopes, e.active, e.granted_at,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'email', m.email,
        'name', COALESCE(p.full_name, NULLIF(BTRIM(CONCAT_WS(' ', p.first_name, p.surname)), '')),
        'tier', m.permission_tier,
        'has_login', m.user_id IS NOT NULL
      ) ORDER BY m.permission_tier, m.email)
      FROM public.management_company_members m
      LEFT JOIN public.profiles p ON p.id = m.user_id
      WHERE m.company_id = c.id AND m.active
    ), '[]'::jsonb),
    (SELECT count(*)::int FROM public.management_company_members m
      WHERE m.company_id = c.id AND m.active)
  FROM public.management_engagements e
  JOIN public.management_companies c ON c.id = e.company_id
  WHERE e.tenant_id = p_tenant_id
  ORDER BY e.active DESC, c.name;
END;
$fn$;

DROP FUNCTION IF EXISTS public.revoke_management_access(uuid);
CREATE OR REPLACE FUNCTION public.revoke_management_access(p_id uuid)
RETURNS public.management_engagements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE e public.management_engagements;
BEGIN
  SELECT * INTO e FROM public.management_engagements WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such engagement' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = e.tenant_id AND tm.user_id = auth.uid()
      AND tm.active IS NOT FALSE AND tm.permission_tier = 'COMMAND'
  ) THEN
    RAISE EXCEPTION 'Only the vessel''s command can end a management engagement' USING ERRCODE = '42501';
  END IF;

  -- Deactivated, never deleted: months this firm signed off name their people,
  -- and the vessel keeps that history after the relationship ends.
  UPDATE public.management_engagements SET active = false, updated_at = now()
   WHERE id = p_id RETURNING * INTO e;
  RETURN e;
END;
$fn$;

-- ── the firm runs its own team ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.management_team(p_company_id uuid)
RETURNS TABLE (
  id uuid, email text, person_name text, permission_tier text,
  active boolean, has_login boolean, invited_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.management_company_members m
    WHERE m.company_id = p_company_id AND m.user_id = auth.uid() AND m.active
  ) THEN
    RAISE EXCEPTION 'Not permitted' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT m.id, m.email,
         COALESCE(p.full_name, NULLIF(BTRIM(CONCAT_WS(' ', p.first_name, p.surname)), '')),
         m.permission_tier, m.active, m.user_id IS NOT NULL, m.invited_at
  FROM public.management_company_members m
  LEFT JOIN public.profiles p ON p.id = m.user_id
  WHERE m.company_id = p_company_id
  ORDER BY m.active DESC, m.permission_tier, m.email;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.management_team_add(
  p_company_id uuid, p_email text, p_tier text DEFAULT 'MEMBER'
)
RETURNS public.management_company_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_email text; v_user uuid; m public.management_company_members;
BEGIN
  v_email := lower(btrim(coalesce(p_email, '')));
  IF v_email = '' OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'That does not look like an email address' USING ERRCODE = '22023';
  END IF;
  IF p_tier NOT IN ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER') THEN
    RAISE EXCEPTION 'Unknown permission tier %', p_tier USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.management_company_members m2
    WHERE m2.company_id = p_company_id AND m2.user_id = auth.uid() AND m2.active
      AND m2.permission_tier IN ('OWNER', 'ADMIN')
  ) THEN
    RAISE EXCEPTION 'Only an owner or admin can add to the team' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_user FROM auth.users WHERE lower(email) = v_email LIMIT 1;

  INSERT INTO public.management_company_members
    (company_id, user_id, email, permission_tier, invited_by, claimed_at)
  VALUES (p_company_id, v_user, v_email, p_tier, auth.uid(),
          CASE WHEN v_user IS NULL THEN NULL ELSE now() END)
  ON CONFLICT (company_id, email) DO UPDATE
    SET active = true, permission_tier = excluded.permission_tier,
        user_id = coalesce(public.management_company_members.user_id, excluded.user_id),
        updated_at = now()
  RETURNING * INTO m;
  RETURN m;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.management_team_remove(p_member_id uuid)
RETURNS public.management_company_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE m public.management_company_members; v_owners int;
BEGIN
  SELECT * INTO m FROM public.management_company_members WHERE id = p_member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such team member' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.management_company_members m2
    WHERE m2.company_id = m.company_id AND m2.user_id = auth.uid() AND m2.active
      AND m2.permission_tier IN ('OWNER', 'ADMIN')
  ) THEN
    RAISE EXCEPTION 'Only an owner or admin can remove someone' USING ERRCODE = '42501';
  END IF;

  -- A firm with no owner left is a workspace nobody can administer, and the
  -- vessels stay engaged to it either way.
  IF m.permission_tier = 'OWNER' THEN
    SELECT count(*) INTO v_owners FROM public.management_company_members
     WHERE company_id = m.company_id AND active AND permission_tier = 'OWNER';
    IF v_owners <= 1 THEN
      RAISE EXCEPTION 'Make someone else an owner first' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.management_company_members SET active = false, updated_at = now()
   WHERE id = p_member_id RETURNING * INTO m;
  RETURN m;
END;
$fn$;

-- ── claiming ─────────────────────────────────────────────────────────────────
-- Runs when a session starts. Someone added to a firm before they had a login
-- picks up their place — and with it every vessel that firm is engaged on.
CREATE OR REPLACE FUNCTION public.claim_management_access()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_email text; v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email IS NULL THEN RETURN 0; END IF;

  UPDATE public.management_company_members
     SET user_id = auth.uid(), claimed_at = now(), updated_at = now()
   WHERE user_id IS NULL AND active AND email = v_email;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

-- The email-keyed table this replaces. It never held a row.
DROP TABLE IF EXISTS public.management_members;

GRANT EXECUTE ON FUNCTION public.is_management_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.management_can(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.management_can_write(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_management_companies() TO authenticated;
GRANT EXECUTE ON FUNCTION public.management_fleet() TO authenticated;
GRANT EXECUTE ON FUNCTION public.management_sign_off(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.management_query(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_management_access(uuid, text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_management_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_management_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.management_team(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.management_team_add(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.management_team_remove(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_management_access() TO authenticated;

-- Cargo — what a management grant actually covers.
--
-- The first two migrations built the management relationship around one subject:
-- month-end spending. That was too narrow. The shore office also reads Hours of
-- Rest and the rest of the monthly close-off — /month-end already models those
-- as packs — so "can this person see this vessel" is the wrong question. The
-- question is which parts.
--
-- Doing this before there are grants in the wild is the entire point: retrofitting
-- a scope onto rows that were created without one means guessing what the boat
-- meant, and guessing wide.
--
-- Scopes are an array rather than columns because the set grows with the packs on
-- /month-end (sea time, drills, timesheets, certificates, inventory are all
-- planned). A new area should be a value, not a migration on every row.

ALTER TABLE public.management_members
  ADD COLUMN IF NOT EXISTS scopes text[] NOT NULL DEFAULT ARRAY['accounts']::text[];

-- Zero scopes would be a grant that grants nothing, which is a withdrawal
-- wearing the wrong hat — `active = false` already says that, and says it in a
-- way the vessel's list can show.
ALTER TABLE public.management_members
  DROP CONSTRAINT IF EXISTS management_members_scopes_known;
ALTER TABLE public.management_members
  ADD CONSTRAINT management_members_scopes_known CHECK (
    scopes <@ ARRAY['accounts', 'hor', 'month_end']::text[]
    AND coalesce(array_length(scopes, 1), 0) >= 1
  );

COMMENT ON COLUMN public.management_members.scopes IS
  'Which areas of the vessel this grant covers: accounts (month-end spending), hor (Hours of Rest), month_end (the monthly close-off packs). Checked by management_can().';

-- ── the gate ─────────────────────────────────────────────────────────────────
-- is_management_member() answers "is there a relationship at all" and stays as
-- the cheap test for drawing a management shell. Anything that returns a
-- vessel's actual data asks this instead.
CREATE OR REPLACE FUNCTION public.management_can(
  p_tenant_id uuid, p_scope text, p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.management_members
    WHERE tenant_id = p_tenant_id AND user_id = p_user_id AND active
      AND p_scope = ANY (scopes)
  );
$fn$;

-- ── the accounts functions now ask for the accounts scope ────────────────────
-- Same bodies as 20260804104024; the only change is the gate. Spelled out rather
-- than left inheriting the broad check, because a grant for Hours of Rest must
-- not hand over the vessel's bank lines.
CREATE OR REPLACE FUNCTION public.management_periods(p_tenant_id uuid)
RETURNS TABLE (period_month date, accounts integer, awaiting integer, signed_off integer, queried integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT
    r.period_month,
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE r.status = 'submitted')::int,
    COUNT(*) FILTER (WHERE r.status = 'approved')::int,
    COUNT(*) FILTER (WHERE r.status = 'open' AND r.queried_at IS NOT NULL)::int
  FROM public.account_reconciliations r
  WHERE r.tenant_id = p_tenant_id
    AND public.management_can(p_tenant_id, 'accounts')
    AND (r.status <> 'open' OR r.queried_at IS NOT NULL)
  GROUP BY r.period_month
  ORDER BY r.period_month DESC;
$fn$;

CREATE OR REPLACE FUNCTION public.management_month(p_tenant_id uuid, p_period_month date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.management_can(p_tenant_id, 'accounts') THEN
    RAISE EXCEPTION 'Not permitted' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'vessel', (SELECT jsonb_build_object('id', t.id, 'name', t.name)
                 FROM public.tenants t WHERE t.id = p_tenant_id),
    'period', p_period_month,
    'accounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'kind', a.kind, 'currency', a.currency,
        'funds_type', a.funds_type, 'holder_role', a.holder_role,
        'holder_user_id', a.holder_user_id, 'card_last4', a.card_last4,
        'provider', a.provider, 'opening_balance', a.opening_balance
      ) ORDER BY a.name)
      FROM public.financial_accounts a
      WHERE a.tenant_id = p_tenant_id AND a.is_active IS NOT FALSE
    ), '[]'::jsonb),
    'reconciliations', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) - 'created_by')
      FROM public.account_reconciliations r
      WHERE r.tenant_id = p_tenant_id AND r.period_month = p_period_month
    ), '[]'::jsonb),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', tx.id, 'account_id', tx.account_id,
        'txn_date', tx.txn_date, 'statement_date', tx.statement_date,
        'description', tx.description, 'note', tx.note, 'payee', tx.payee,
        'category', tx.category, 'category_code', tx.category_code,
        'department', tx.department, 'allocation', tx.allocation,
        'charter_ref', tx.charter_ref, 'amount', tx.amount, 'currency', tx.currency,
        'amount_base', tx.amount_base, 'vat_amount', tx.vat_amount,
        'source', tx.source, 'status', tx.status, 'is_pending', tx.is_pending,
        'crew_id', tx.crew_id, 'crew_name', COALESCE(p.full_name,
          NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.surname)), '')),
        'supplier_invoice_id', tx.supplier_invoice_id,
        'created_at', tx.created_at,
        'has_receipt', (
          tx.supplier_invoice_id IS NOT NULL
          OR tx.receipt_waived IS TRUE
          OR EXISTS (SELECT 1 FROM public.ledger_transaction_attachments att
                      WHERE att.ledger_transaction_id = tx.id)
        )
      ) ORDER BY tx.txn_date, tx.created_at)
      FROM public.ledger_transactions tx
      LEFT JOIN public.profiles p ON p.id = tx.crew_id
      WHERE tx.tenant_id = p_tenant_id
        AND tx.status <> 'void'
        AND COALESCE(tx.statement_date, tx.txn_date) >= (p_period_month - INTERVAL '2 months')
        AND COALESCE(tx.statement_date, tx.txn_date) < (p_period_month + INTERVAL '1 month')
    ), '[]'::jsonb),
    'closes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('period_month', c.period_month, 'submitted_at', c.submitted_at))
      FROM public.account_reconciliations c
      WHERE c.tenant_id = p_tenant_id AND c.status <> 'open' AND c.submitted_at IS NOT NULL
    ), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.management_sign_off(p_reconciliation_id uuid, p_note text DEFAULT NULL)
RETURNS public.account_reconciliations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE r public.account_reconciliations;
BEGIN
  SELECT * INTO r FROM public.account_reconciliations WHERE id = p_reconciliation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That month is not on file' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.management_can(r.tenant_id, 'accounts') THEN
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
  IF NOT public.management_can(r.tenant_id, 'accounts') THEN
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

-- ── the fleet list carries the scopes ────────────────────────────────────────
-- The office's own shell has to know which sections to draw per vessel: they may
-- hold Hours of Rest on one boat and the whole month-end on another.
DROP FUNCTION IF EXISTS public.management_fleet();
CREATE OR REPLACE FUNCTION public.management_fleet()
RETURNS TABLE (
  tenant_id uuid, vessel_name text, company_name text, scopes text[],
  awaiting_signoff integer, signed_off integer, queried integer,
  latest_period date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT
    mm.tenant_id,
    t.name,
    mm.company_name,
    mm.scopes,
    COUNT(*) FILTER (WHERE r.status = 'submitted' AND 'accounts' = ANY (mm.scopes))::int,
    COUNT(*) FILTER (WHERE r.status = 'approved' AND 'accounts' = ANY (mm.scopes))::int,
    COUNT(*) FILTER (WHERE r.status = 'open' AND r.queried_at IS NOT NULL AND 'accounts' = ANY (mm.scopes))::int,
    MAX(r.period_month) FILTER (WHERE 'accounts' = ANY (mm.scopes))
  FROM public.management_members mm
  JOIN public.tenants t ON t.id = mm.tenant_id
  LEFT JOIN public.account_reconciliations r ON r.tenant_id = mm.tenant_id
  WHERE mm.user_id = auth.uid() AND mm.active
  GROUP BY mm.tenant_id, t.name, mm.company_name, mm.scopes
  ORDER BY t.name;
$fn$;

-- ── granting and listing carry them too ──────────────────────────────────────
DROP FUNCTION IF EXISTS public.grant_management_access(uuid, text, text);
CREATE OR REPLACE FUNCTION public.grant_management_access(
  p_tenant_id uuid, p_email text, p_company_name text DEFAULT NULL,
  p_scopes text[] DEFAULT ARRAY['accounts']::text[]
)
RETURNS public.management_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_email text; v_user uuid; v_scopes text[]; r public.management_members;
BEGIN
  v_email := lower(btrim(coalesce(p_email, '')));
  IF v_email = '' OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'That does not look like an email address' USING ERRCODE = '22023';
  END IF;

  -- Deduplicated and ordered so the same choice always stores the same array —
  -- otherwise two identical grants compare as different rows.
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
    RAISE EXCEPTION 'Only the vessel''s command can give management access' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tenant_members tm
    JOIN auth.users u ON u.id = tm.user_id
    WHERE tm.tenant_id = p_tenant_id AND tm.active IS NOT FALSE AND lower(u.email) = v_email
  ) THEN
    RAISE EXCEPTION 'That address is already crew on this vessel' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_user FROM auth.users WHERE lower(email) = v_email LIMIT 1;

  SELECT * INTO r FROM public.management_members
   WHERE tenant_id = p_tenant_id
     AND (lower(email) = v_email OR (v_user IS NOT NULL AND user_id = v_user))
   LIMIT 1;

  IF FOUND THEN
    UPDATE public.management_members
       SET active = true, email = v_email, user_id = coalesce(v_user, user_id),
           scopes = v_scopes,
           company_name = coalesce(nullif(btrim(coalesce(p_company_name, '')), ''), company_name),
           claimed_at = CASE WHEN claimed_at IS NULL AND v_user IS NOT NULL THEN now() ELSE claimed_at END,
           updated_at = now()
     WHERE id = r.id
     RETURNING * INTO r;
    RETURN r;
  END IF;

  INSERT INTO public.management_members (user_id, tenant_id, email, company_name, scopes, invited_by, claimed_at)
  VALUES (v_user, p_tenant_id, v_email, nullif(btrim(coalesce(p_company_name, '')), ''), v_scopes, auth.uid(),
          CASE WHEN v_user IS NULL THEN NULL ELSE now() END)
  RETURNING * INTO r;

  RETURN r;
END;
$fn$;

DROP FUNCTION IF EXISTS public.list_management_access(uuid);
CREATE OR REPLACE FUNCTION public.list_management_access(p_tenant_id uuid)
RETURNS TABLE (
  id uuid, email text, company_name text, person_name text, scopes text[],
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
         mm.scopes, mm.active, mm.granted_at, mm.claimed_at, mm.user_id IS NOT NULL
  FROM public.management_members mm
  LEFT JOIN public.profiles p ON p.id = mm.user_id
  WHERE mm.tenant_id = p_tenant_id
  ORDER BY mm.active DESC, mm.granted_at DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.management_can(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.management_fleet() TO authenticated;
GRANT EXECUTE ON FUNCTION public.management_periods(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.management_month(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.management_sign_off(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.management_query(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_management_access(uuid, text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_management_access(uuid) TO authenticated;

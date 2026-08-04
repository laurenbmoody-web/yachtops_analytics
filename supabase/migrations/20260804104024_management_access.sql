-- Cargo Accounts — the management company's way in.
--
-- The crew complete the month; the office balances the owner's funds against it.
-- Until now the only route out was the CSV export, so management were reading a
-- file and replying by email. This gives them a login instead: read the closed
-- months, and either sign one off or send it back with a question.
--
-- What they explicitly must NOT do is edit what the crew entered. That line is
-- the whole design of this file:
--
--   * management users are NOT rows in tenant_members. Every write policy in
--     this schema — 130-odd of them — is keyed on is_active_tenant_member(), so
--     a management row in that table would inherit write access to provisioning,
--     crew records, the lot, and keeping it out would mean auditing all of them
--     and every future one. A separate table means no existing policy can see
--     them at all, and no future policy can accidentally let them in.
--
--   * they therefore have no table-level grants whatsoever. Reads come through
--     SECURITY DEFINER functions that return exactly the month-end pack, and
--     writes through two functions that touch exactly two lifecycle actions.
--     There is no code path from a management session to an UPDATE on
--     ledger_transactions, because no such path is written.
--
-- Sign-off and query are recorded on their own columns rather than in `note` —
-- overwriting the crew's note with the office's reason would be editing their
-- entry by the back door.

-- ── who they are ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.management_members (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id    uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- One person, many boats: the row is per vessel, so the office gets access to
  -- the boats they actually manage and no others.
  company_name text,
  active       boolean     NOT NULL DEFAULT true,
  invited_by   uuid        REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_management_members_user ON public.management_members(user_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_management_members_tenant ON public.management_members(tenant_id) WHERE active;

DROP TRIGGER IF EXISTS set_management_members_updated_at ON public.management_members;
CREATE TRIGGER set_management_members_updated_at
  BEFORE UPDATE ON public.management_members
  FOR EACH ROW EXECUTE FUNCTION public.handle_account_reconciliations_updated_at();

ALTER TABLE public.management_members ENABLE ROW LEVEL SECURITY;

-- A management user may see their own access (that's what draws their vessel
-- list). COMMAND on a vessel administers who manages it.
DROP POLICY IF EXISTS "management_members_select" ON public.management_members;
CREATE POLICY "management_members_select"
  ON public.management_members FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = management_members.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active IS NOT FALSE
        AND tm.permission_tier = 'COMMAND')
  );

DROP POLICY IF EXISTS "management_members_write" ON public.management_members;
CREATE POLICY "management_members_write"
  ON public.management_members FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = management_members.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active IS NOT FALSE
        AND tm.permission_tier = 'COMMAND')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = management_members.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active IS NOT FALSE
        AND tm.permission_tier = 'COMMAND')
  );

CREATE OR REPLACE FUNCTION public.is_management_member(p_tenant_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.management_members
    WHERE tenant_id = p_tenant_id AND user_id = p_user_id AND active
  );
$$;

-- ── the trail a sign-off or a query leaves ───────────────────────────────────
ALTER TABLE public.account_reconciliations
  ADD COLUMN IF NOT EXISTS queried_at   timestamptz,
  ADD COLUMN IF NOT EXISTS queried_by   uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS query_note   text,
  ADD COLUMN IF NOT EXISTS signoff_note text;

COMMENT ON COLUMN public.account_reconciliations.query_note IS
  'Why the office sent this month back. Separate from note, which is the crew''s.';
COMMENT ON COLUMN public.account_reconciliations.signoff_note IS
  'Anything the office added when signing off. Separate from note, which is the crew''s.';

-- ── what they can read ───────────────────────────────────────────────────────
-- The vessels this login manages, with enough on each to open the right one.
CREATE OR REPLACE FUNCTION public.management_fleet()
RETURNS TABLE (
  tenant_id uuid, vessel_name text, company_name text,
  awaiting_signoff integer, signed_off integer, queried integer,
  latest_period date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    mm.tenant_id,
    t.name,
    mm.company_name,
    COUNT(*) FILTER (WHERE r.status = 'submitted')::int,
    COUNT(*) FILTER (WHERE r.status = 'approved')::int,
    COUNT(*) FILTER (WHERE r.status = 'open' AND r.queried_at IS NOT NULL)::int,
    MAX(r.period_month)
  FROM public.management_members mm
  JOIN public.tenants t ON t.id = mm.tenant_id
  LEFT JOIN public.account_reconciliations r ON r.tenant_id = mm.tenant_id
  WHERE mm.user_id = auth.uid() AND mm.active
  GROUP BY mm.tenant_id, t.name, mm.company_name
  ORDER BY t.name;
$$;

-- The periods worth opening on one vessel: anything that has left 'open', plus
-- anything sent back, newest first.
CREATE OR REPLACE FUNCTION public.management_periods(p_tenant_id uuid)
RETURNS TABLE (period_month date, accounts integer, awaiting integer, signed_off integer, queried integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.period_month,
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE r.status = 'submitted')::int,
    COUNT(*) FILTER (WHERE r.status = 'approved')::int,
    COUNT(*) FILTER (WHERE r.status = 'open' AND r.queried_at IS NOT NULL)::int
  FROM public.account_reconciliations r
  WHERE r.tenant_id = p_tenant_id
    AND public.is_management_member(p_tenant_id)
    AND (r.status <> 'open' OR r.queried_at IS NOT NULL)
  GROUP BY r.period_month
  ORDER BY r.period_month DESC;
$$;

-- One month on one vessel: the accounts, their reconciliations, and every line
-- under them. Deliberately the same material as the CSV export — the office was
-- reading that file before, and this is the same pack without the email.
--
-- It returns a WINDOW of lines — the period and the two months before it — plus
-- every close the vessel has made, rather than the month's lines as SQL would
-- group them. A line entered after its month was closed reconciles into the NEXT
-- month (services/monthEnd.reconcilePeriod), so calendar grouping here would put
-- lines in a month the boat never closed them into. That rule is written and
-- tested once, in JS; this hands the client what it needs to apply it rather
-- than keeping a second copy of it in Postgres to drift.
CREATE OR REPLACE FUNCTION public.management_month(p_tenant_id uuid, p_period_month date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.is_management_member(p_tenant_id) THEN
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
        -- The office's first question about any line is whether it is evidenced;
        -- they get the answer, not the file. Documents stay on the boat.
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
$$;

-- ── the only two things they can write ───────────────────────────────────────
-- Sign off. A month must have been closed by the boat first — the office
-- approves the crew's figures, it does not produce them.
CREATE OR REPLACE FUNCTION public.management_sign_off(p_reconciliation_id uuid, p_note text DEFAULT NULL)
RETURNS public.account_reconciliations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.account_reconciliations;
BEGIN
  SELECT * INTO r FROM public.account_reconciliations WHERE id = p_reconciliation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That month is not on file' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_management_member(r.tenant_id) THEN
    RAISE EXCEPTION 'Not permitted' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'submitted' THEN
    RAISE EXCEPTION 'Only a month the vessel has closed can be signed off (this one is %)', r.status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.account_reconciliations
     SET status = 'approved',
         approved_by = auth.uid(),
         approved_at = now(),
         signoff_note = NULLIF(BTRIM(COALESCE(p_note, '')), ''),
         queried_at = NULL, queried_by = NULL, query_note = NULL
   WHERE id = p_reconciliation_id
   RETURNING * INTO r;
  RETURN r;
END;
$$;

-- Query it back. Reopens the month for the boat and says why — a query with no
-- reason on it is just a rejection the crew have to guess at.
CREATE OR REPLACE FUNCTION public.management_query(p_reconciliation_id uuid, p_note text)
RETURNS public.account_reconciliations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.account_reconciliations;
BEGIN
  IF COALESCE(BTRIM(p_note), '') = '' THEN
    RAISE EXCEPTION 'A query needs a reason' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO r FROM public.account_reconciliations WHERE id = p_reconciliation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That month is not on file' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_management_member(r.tenant_id) THEN
    RAISE EXCEPTION 'Not permitted' USING ERRCODE = '42501';
  END IF;
  IF r.status = 'open' THEN
    RAISE EXCEPTION 'That month is already back with the vessel' USING ERRCODE = '22023';
  END IF;

  UPDATE public.account_reconciliations
     SET status = 'open',
         submitted_at = NULL,
         approved_by = NULL, approved_at = NULL, signoff_note = NULL,
         queried_at = now(), queried_by = auth.uid(), query_note = BTRIM(p_note)
   WHERE id = p_reconciliation_id
   RETURNING * INTO r;
  RETURN r;
END;
$$;

-- Callable by any signed-in user; every one of them decides for itself whether
-- the caller manages that vessel. Nothing else is granted — a management login
-- has no table privileges in this schema at all.
GRANT EXECUTE ON FUNCTION public.management_fleet() TO authenticated;
GRANT EXECUTE ON FUNCTION public.management_periods(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.management_month(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.management_sign_off(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.management_query(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_management_member(uuid, uuid) TO authenticated;

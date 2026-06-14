-- ============================================================
-- Quick Add Past Orders — dept-scoped read RPC
-- ============================================================
--
-- Adds get_quick_add_past_orders(p_tenant_id, p_limit) — sibling to
-- get_quick_add_favourites from 20260604120000. Same SECURITY DEFINER
-- + dept-scoping pattern. No is_favourite filter (returns every past
-- order the user can see), sorted newest-first, hard-capped at 100
-- rows by default.
--
-- Why a separate RPC and not a flag on the existing favourites RPC:
-- semantic clarity. Sort orders differ (favourited_at vs sent_at),
-- limits differ (favourites are by definition few; past orders accumulate),
-- and the names should match what each function does. Duplication is
-- ~30 lines and contained.
--
-- Status filter rationale:
-- supplier_orders.status enum (set in 20260430110500_supplier_orders_
-- status_8_stage_lifecycle.sql) has 8 values:
--   draft, sent, confirmed, dispatched, out_for_delivery,
--   received, invoiced, paid
-- Past Orders should surface anything that's been dispatched at any
-- stage — 'sent' through 'paid' all qualify. Only 'draft' is excluded
-- (a never-sent order isn't a past order; if a user wants to clone a
-- draft they use Templates or Copy Board). The `<> 'draft'` form is
-- equivalent to the 7-value IN list and reads more cleanly — if a
-- future status is added, it surfaces in Past Orders by default
-- (correct behaviour — new dispatched-or-later state should appear).
--
-- Cancellation/rejection: confirmed (via migrations + code grep) that
-- supplier_orders has no 'cancelled' / 'rejected' / equivalent state.
-- If one is added later, this filter will need re-evaluation.
--
-- Pagination: hard-bounded at 1–500. Default 100. UI shows a footer
-- when the limit is hit ("Showing the 100 most recent orders."). v1
-- has no infinite-scroll / "Load older"; revisit when crew hit the
-- limit regularly (current scale: Lauren's tenant at 8 orders).
--
-- is_favourite returned alongside: lets a Past Orders card render an
-- interactive star (re-using toggle_supplier_order_favourite) so the
-- favourites/past-orders distinction stays soft — a user can star an
-- order they see in Past Orders without navigating to the Orders tab.
-- Same tier+dept gate as the existing toggle RPC.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_quick_add_past_orders(
  p_tenant_id uuid,
  p_limit     int DEFAULT 100
)
RETURNS TABLE (
  id                  uuid,
  supplier_name       text,
  supplier_profile_id uuid,
  created_at          timestamptz,
  sent_at             timestamptz,
  delivery_date       date,
  departments         text[],
  is_favourite        boolean,
  item_count          bigint
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_user_id        uuid := auth.uid();
  v_tier           text;
  v_user_dept_name text;
BEGIN
  SELECT tm.permission_tier, d.name
    INTO v_tier, v_user_dept_name
  FROM public.tenant_members tm
  LEFT JOIN public.departments d ON d.id = tm.department_id
  WHERE tm.user_id = v_user_id
    AND tm.tenant_id = p_tenant_id
    AND tm.active = true
  LIMIT 1;

  IF v_tier IS NULL THEN
    RETURN;  -- not a member of this tenant — empty set
  END IF;

  RETURN QUERY
  SELECT so.id,
         so.supplier_name,
         so.supplier_profile_id,
         so.created_at,
         so.sent_at,
         so.delivery_date,
         so.departments,
         so.is_favourite,
         (SELECT count(*)
            FROM public.supplier_order_items soi
            WHERE soi.order_id = so.id) AS item_count
  FROM public.supplier_orders so
  WHERE so.tenant_id = p_tenant_id
    AND so.status <> 'draft'
    AND (v_tier = 'COMMAND' OR v_user_dept_name = ANY(so.departments))
  ORDER BY so.sent_at DESC NULLS LAST, so.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
END $$;

GRANT EXECUTE ON FUNCTION public.get_quick_add_past_orders(uuid, int) TO authenticated;

COMMENT ON FUNCTION public.get_quick_add_past_orders(uuid, int) IS
  'Returns dispatched-or-later supplier_orders visible to the caller, dept-scoped: COMMAND sees all in the tenant; CHIEF/HOD/CREW see only orders whose departments[] includes their department. Sorted newest-first by sent_at. Hard-bounded at 1-500 rows (default 100). Powers the Quick Add Past Orders tab.';

COMMIT;

-- ============================================================
-- Verification queries — run after applying.
-- ============================================================
--
-- 1. Function registered correctly:
--
--    SELECT proname, pronargs, prosecdef
--      FROM pg_proc
--      WHERE proname = 'get_quick_add_past_orders';
--
--    Expect 1 row, pronargs = 2, prosecdef = true (SECURITY DEFINER).
--
-- 2. Status enum confirmation (sanity check before relying on the
--    `<> 'draft'` filter — surfaces any unexpected values):
--
--    SELECT DISTINCT status FROM public.supplier_orders ORDER BY 1;
--
--    Expect values only from: draft, sent, confirmed, dispatched,
--    out_for_delivery, received, invoiced, paid.
--    If anything else appears, flag before testing the RPC.
--
-- 3. Smoke-test the read RPC (substitute your tenant id):
--
--    SELECT * FROM public.get_quick_add_past_orders('YOUR-TENANT-ID-HERE');
--
--    For Lauren's tenant (8 supplier_orders): expect a subset of those
--    8 dispatched-or-later, dept-scoped to the calling user. Sort
--    newest-first by sent_at.
--
-- 4. Confirm dept-scoping behaviour. Call as a CREW/HOD user in a
--    specific dept — should see only orders whose departments[]
--    includes their dept. Call as COMMAND — should see all.
--    (Studio doesn't simulate auth contexts directly; verify via
--    the JS once the UI lands, OR temporarily impersonate via the
--    Supabase JWT settings in Studio.)
--
-- 5. Limit-bound smoke-test:
--
--    SELECT count(*) FROM public.get_quick_add_past_orders('YOUR-TENANT-ID-HERE', 500);
--    -- caps at 500 even if the actual count is higher
--    SELECT count(*) FROM public.get_quick_add_past_orders('YOUR-TENANT-ID-HERE', 0);
--    -- still returns ≥1 row (lower bound)
--

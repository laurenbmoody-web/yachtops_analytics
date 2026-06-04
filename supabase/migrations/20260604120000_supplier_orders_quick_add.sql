-- ============================================================
-- supplier_orders Quick Add — favourites + dept-scoped curation +
-- strict-snapshot apply
-- ============================================================
--
-- Background
-- ----------
-- A "Quick Add" panel on the provisioning board lets crew apply a
-- previously-sent supplier order onto a new board with one click. The
-- primitive that drives this is starring whole supplier_orders. Stars
-- are CHIEF/HOD-curated and surface only in departments whose items
-- the order included at send time.
--
-- Decisions reflected in this migration
-- -------------------------------------
--
-- 1. STAR PRIMITIVE — whole supplier_orders (not individual items).
--    is_favourite + favourited_at + favourited_by columns capture
--    state + audit ("Lauren picked this in May 2026").
--
-- 2. DEPT SCOPE — supplier_orders.departments[] is a denormalized
--    snapshot computed at send time from the items in the order.
--    A favourite surfaces in EVERY department whose items the order
--    included. Cross-dept orders surface in both/all depts.
--
-- 3. CURATION GATE — NOT a tier-gated UPDATE policy. The existing
--    "tenant members can manage supplier_orders" FOR ALL policy
--    already grants UPDATE to any tenant member, and multiple
--    PERMISSIVE policies OR together — a stricter UPDATE policy
--    cannot restrict. The toggle goes through a SECURITY DEFINER RPC
--    with explicit IF checks on permission_tier + dept intersection.
--    Same pattern as delete_provisioning_board.
--
-- 4. STRICT-INTERPRETATION SNAPSHOT — supplier_order_items gains
--    brand, size, category, sub_category, department, allergen_flags,
--    supplier_profile_id so apply-favourite restores the SPECIFIC
--    item ("Molton Brown Pink Pepperpod 250ml") rather than the
--    generic name ("body wash"). A thin snapshot wouldn't be a
--    usable feature. Naming asymmetry note: provisioning_items.
--    estimated_unit_cost ↔ supplier_order_items.estimated_price
--    (the order-items column already exists, added in
--    20260429100000_supplier_order_items_split_prices.sql); JS
--    bridges the names at send/apply time.
--
-- 5. NO BACK-FILL — pre-migration orders have departments='{}' and
--    null snapshot fields. Only COMMAND can favourite them (CHIEF/HOD
--    dept-intersect fails on an empty array). Apply-favourite on
--    pre-migration orders is lossy (name/qty/unit/notes only). This
--    is the documented v1 limitation. If crew complain, a separate
--    back-fill script can populate departments[] from provisioning_
--    items joined by list_id.
--
-- Verification queries are listed at the bottom of this file (after
-- COMMIT). Run them after applying to confirm columns + indexes +
-- RPCs landed and pre-migration rows defaulted cleanly.
-- ============================================================

BEGIN;

-- ─── 1. supplier_orders: favourites primitive + dept snapshot ────────
ALTER TABLE public.supplier_orders
  ADD COLUMN IF NOT EXISTS is_favourite  boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS favourited_at timestamptz,
  ADD COLUMN IF NOT EXISTS favourited_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS departments   text[]      NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS supplier_orders_is_favourite_idx
  ON public.supplier_orders(is_favourite) WHERE is_favourite = true;

CREATE INDEX IF NOT EXISTS supplier_orders_departments_gin_idx
  ON public.supplier_orders USING gin(departments);

COMMENT ON COLUMN public.supplier_orders.is_favourite IS
  'CHIEF/HOD-curated favourite. Surfaces in the Quick Add panel for users whose department intersects departments[]. Toggle via toggle_supplier_order_favourite() RPC — table-level RLS does not gate this column because the existing FOR ALL policy OR-combines with permissive policies.';
COMMENT ON COLUMN public.supplier_orders.favourited_by IS
  'Audit trail — who curated this favourite. Nulled on unstar. Useful for institutional-memory queries.';
COMMENT ON COLUMN public.supplier_orders.departments IS
  'Distinct departments captured from supplier_order_items at send time. Frozen snapshot. Drives Quick Add dept-scoping. Pre-migration rows = {} (no back-fill — only COMMAND can curate those).';

-- ─── 2. supplier_order_items: strict-snapshot extension ──────────────
-- Mirrors provisioning_items at send time. Nullable + IF NOT EXISTS
-- — pre-migration rows + future inserts that don't carry these fields
-- continue to work. estimated_price was added previously in
-- 20260429100000_supplier_order_items_split_prices.sql and stays as-is.
ALTER TABLE public.supplier_order_items
  ADD COLUMN IF NOT EXISTS brand               text,
  ADD COLUMN IF NOT EXISTS size                text,
  ADD COLUMN IF NOT EXISTS category            text,
  ADD COLUMN IF NOT EXISTS sub_category        text,
  ADD COLUMN IF NOT EXISTS department          text,
  ADD COLUMN IF NOT EXISTS allergen_flags      text[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS supplier_profile_id uuid
    REFERENCES public.supplier_profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.supplier_order_items.brand IS
  'Snapshot of provisioning_items.brand at send time. Drives faithful apply-favourite.';
COMMENT ON COLUMN public.supplier_order_items.size IS
  'Snapshot of provisioning_items.size at send time.';
COMMENT ON COLUMN public.supplier_order_items.category IS
  'Snapshot of provisioning_items.category at send time.';
COMMENT ON COLUMN public.supplier_order_items.sub_category IS
  'Snapshot of provisioning_items.sub_category at send time.';
COMMENT ON COLUMN public.supplier_order_items.department IS
  'Snapshot of provisioning_items.department at send time. Aggregated into supplier_orders.departments[] for Quick Add dept-scoping.';
COMMENT ON COLUMN public.supplier_order_items.allergen_flags IS
  'Snapshot of provisioning_items.allergen_flags at send time.';
COMMENT ON COLUMN public.supplier_order_items.supplier_profile_id IS
  'Snapshot of provisioning_items.supplier_profile_id at send time. Lets apply-favourite re-link the new board item to the same supplier without a name-match lookup.';

-- ─── 3. Toggle RPC (CHIEF/HOD curation gate) ────────────────────────
CREATE OR REPLACE FUNCTION public.toggle_supplier_order_favourite(p_order_id uuid)
RETURNS public.supplier_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id        uuid := auth.uid();
  v_order          public.supplier_orders%ROWTYPE;
  v_tier           text;
  v_user_dept_name text;
BEGIN
  SELECT * INTO v_order
  FROM public.supplier_orders
  WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  SELECT tm.permission_tier, d.name
    INTO v_tier, v_user_dept_name
  FROM public.tenant_members tm
  LEFT JOIN public.departments d ON d.id = tm.department_id
  WHERE tm.user_id = v_user_id
    AND tm.tenant_id = v_order.tenant_id
    AND tm.active = true
  LIMIT 1;

  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'Not a member of this tenant';
  END IF;

  IF v_tier NOT IN ('COMMAND', 'CHIEF') THEN
    RAISE EXCEPTION 'Only the department head can favourite orders';
  END IF;

  -- COMMAND can curate any tenant order; CHIEF must intersect dept.
  IF v_tier = 'CHIEF' AND NOT (v_user_dept_name = ANY(v_order.departments)) THEN
    RAISE EXCEPTION 'Only the department head can favourite orders';
  END IF;

  IF v_order.is_favourite THEN
    UPDATE public.supplier_orders
      SET is_favourite  = false,
          favourited_at = NULL,
          favourited_by = NULL
    WHERE id = p_order_id
    RETURNING * INTO v_order;
  ELSE
    UPDATE public.supplier_orders
      SET is_favourite  = true,
          favourited_at = now(),
          favourited_by = v_user_id
    WHERE id = p_order_id
    RETURNING * INTO v_order;
  END IF;

  RETURN v_order;
END $$;

GRANT EXECUTE ON FUNCTION public.toggle_supplier_order_favourite(uuid) TO authenticated;

COMMENT ON FUNCTION public.toggle_supplier_order_favourite(uuid) IS
  'Toggles supplier_orders.is_favourite. Caller must be COMMAND (any dept) or CHIEF whose department intersects the order''s departments[] array. Raises on tier/dept failure. Returns the updated row.';

-- ─── 4. Read RPC (dept-scoped favourites for current user) ──────────
CREATE OR REPLACE FUNCTION public.get_quick_add_favourites(p_tenant_id uuid)
RETURNS TABLE (
  id                  uuid,
  supplier_name       text,
  supplier_profile_id uuid,
  created_at          timestamptz,
  sent_at             timestamptz,
  delivery_date       date,
  departments         text[],
  favourited_at       timestamptz,
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
         so.favourited_at,
         (SELECT count(*)
            FROM public.supplier_order_items soi
            WHERE soi.order_id = so.id) AS item_count
  FROM public.supplier_orders so
  WHERE so.tenant_id = p_tenant_id
    AND so.is_favourite = true
    AND (v_tier = 'COMMAND' OR v_user_dept_name = ANY(so.departments))
  ORDER BY so.favourited_at DESC NULLS LAST;
END $$;

GRANT EXECUTE ON FUNCTION public.get_quick_add_favourites(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_quick_add_favourites(uuid) IS
  'Returns favourited supplier_orders visible to the caller, dept-scoped: COMMAND sees all in the tenant; CHIEF/HOD/CREW see only orders whose departments[] includes their department. Used by the Quick Add panel.';

COMMIT;

-- ============================================================
-- Verification queries — run after applying.
-- ============================================================
--
-- 1. Columns landed on supplier_orders:
--
--    SELECT column_name, data_type, is_nullable, column_default
--      FROM information_schema.columns
--      WHERE table_schema = 'public' AND table_name = 'supplier_orders'
--        AND column_name IN ('is_favourite','favourited_at','favourited_by','departments')
--      ORDER BY column_name;
--
--    Expect 4 rows, departments default '{}', is_favourite default false.
--
-- 2. Snapshot columns landed on supplier_order_items:
--
--    SELECT column_name, data_type, is_nullable
--      FROM information_schema.columns
--      WHERE table_schema = 'public' AND table_name = 'supplier_order_items'
--        AND column_name IN ('brand','size','category','sub_category','department','allergen_flags','supplier_profile_id')
--      ORDER BY column_name;
--
--    Expect 7 rows, all nullable (allergen_flags has default '{}').
--
-- 3. Indexes:
--
--    SELECT indexname FROM pg_indexes
--      WHERE schemaname = 'public' AND tablename = 'supplier_orders'
--        AND indexname IN ('supplier_orders_is_favourite_idx','supplier_orders_departments_gin_idx');
--
--    Expect both rows.
--
-- 4. RPCs registered:
--
--    SELECT proname, pronargs, prosecdef
--      FROM pg_proc
--      WHERE proname IN ('toggle_supplier_order_favourite','get_quick_add_favourites');
--
--    Expect 2 rows, both prosecdef = true (SECURITY DEFINER).
--
-- 5. Pre-migration sanity (existing rows defaulted cleanly):
--
--    SELECT count(*) AS total,
--           count(*) FILTER (WHERE NOT is_favourite) AS not_favourite,
--           count(*) FILTER (WHERE departments = '{}') AS empty_departments
--      FROM public.supplier_orders;
--
--    Expect total = not_favourite = empty_departments.
--
-- 6. Smoke-test the toggle RPC (substitute a real order id):
--
--    SELECT public.toggle_supplier_order_favourite('YOUR-ORDER-ID-HERE');
--    -- As COMMAND on the same tenant: should flip is_favourite, set
--    -- favourited_at + favourited_by. Call again to flip off.
--    -- As CHIEF with mismatched dept: should raise.
--
-- 7. Smoke-test the read RPC:
--
--    SELECT * FROM public.get_quick_add_favourites('YOUR-TENANT-ID-HERE');
--    -- Should return favourited orders visible to the caller.
--

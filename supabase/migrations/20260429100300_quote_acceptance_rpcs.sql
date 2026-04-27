-- Vessel-side quote-management RPCs.
--
-- The vessel can't UPDATE supplier_order_items directly — that table is
-- RLS-locked to the supplier. These three SECURITY DEFINER functions do
-- the auth check on the vessel's behalf (active tenant_member of the
-- order's tenant) and bypass RLS to write the state transition. Same
-- architectural pattern as Sprint 9a's getInvoiceSignedUrl.
--
-- Each function returns the updated row so the client can re-render
-- without a separate refetch.

-- ─── accept_order_item_quote ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.accept_order_item_quote(p_item_id uuid)
RETURNS public.supplier_order_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.supplier_order_items;
  v_authorized boolean := false;
BEGIN
  -- Auth: caller must be an active tenant_member of the order's tenant.
  SELECT EXISTS (
    SELECT 1
    FROM public.supplier_order_items soi
    JOIN public.supplier_orders so   ON so.id = soi.order_id
    JOIN public.provisioning_lists pl ON pl.id = so.list_id
    JOIN public.tenant_members tm    ON tm.tenant_id = pl.tenant_id
    WHERE soi.id = p_item_id
      AND tm.user_id = auth.uid()
      AND tm.active = true
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Not authorized to accept this quote';
  END IF;

  UPDATE public.supplier_order_items
  SET
    quote_status    = 'agreed',
    agreed_price    = quoted_price,
    agreed_currency = quoted_currency,
    agreed_at       = now()
  WHERE id = p_item_id
    AND quote_status IN ('quoted', 'in_discussion')
  RETURNING * INTO v_item;

  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'Quote not in acceptable state';
  END IF;

  RETURN v_item;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_order_item_quote(uuid) TO authenticated;

-- ─── decline_order_item_quote ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.decline_order_item_quote(p_item_id uuid)
RETURNS public.supplier_order_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.supplier_order_items;
  v_authorized boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.supplier_order_items soi
    JOIN public.supplier_orders so   ON so.id = soi.order_id
    JOIN public.provisioning_lists pl ON pl.id = so.list_id
    JOIN public.tenant_members tm    ON tm.tenant_id = pl.tenant_id
    WHERE soi.id = p_item_id
      AND tm.user_id = auth.uid()
      AND tm.active = true
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.supplier_order_items
  SET
    quote_status    = 'declined',
    agreed_price    = NULL,
    agreed_currency = NULL,
    agreed_at       = NULL
  WHERE id = p_item_id
    AND quote_status IN ('quoted', 'in_discussion')
  RETURNING * INTO v_item;

  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'Quote not in declinable state';
  END IF;

  RETURN v_item;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decline_order_item_quote(uuid) TO authenticated;

-- ─── query_order_item_quote ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.query_order_item_quote(p_item_id uuid)
RETURNS public.supplier_order_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.supplier_order_items;
  v_authorized boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.supplier_order_items soi
    JOIN public.supplier_orders so   ON so.id = soi.order_id
    JOIN public.provisioning_lists pl ON pl.id = so.list_id
    JOIN public.tenant_members tm    ON tm.tenant_id = pl.tenant_id
    WHERE soi.id = p_item_id
      AND tm.user_id = auth.uid()
      AND tm.active = true
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Only valid from 'quoted'. Lines already in_discussion stay where they
  -- are (the vessel already raised a query and the placeholder modal
  -- says threading is pending).
  UPDATE public.supplier_order_items
  SET quote_status = 'in_discussion'
  WHERE id = p_item_id
    AND quote_status = 'quoted'
  RETURNING * INTO v_item;

  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'Quote not in queryable state';
  END IF;

  RETURN v_item;
END;
$$;

GRANT EXECUTE ON FUNCTION public.query_order_item_quote(uuid) TO authenticated;

COMMENT ON FUNCTION public.accept_order_item_quote  IS 'Vessel-side: accept the supplier''s quoted_price. Auth-checks via tenant_members. Writes agreed_* and emits quote_accepted activity.';
COMMENT ON FUNCTION public.decline_order_item_quote IS 'Vessel-side: decline the supplier''s quoted_price. Auth-checks via tenant_members. Sets quote_status=declined and emits quote_declined activity.';
COMMENT ON FUNCTION public.query_order_item_quote   IS 'Vessel-side: open a query thread on a quoted line. Auth-checks via tenant_members. Sets quote_status=in_discussion and emits discussion_opened activity.';

-- ─── Verification queries (run after apply) ──────────────────────────────
--
-- 1) From a vessel user's session, accept a quoted line (must already be
--    in 'quoted' status — produce one via Run BB's mismatch path):
--
--    SELECT * FROM public.accept_order_item_quote('<item-id>');
--
-- 2) Same shape, decline:
--
--    SELECT * FROM public.decline_order_item_quote('<item-id>');
--
-- 3) Same shape, query:
--
--    SELECT * FROM public.query_order_item_quote('<item-id>');
--
-- 4) Confirm activity events landed:
--
--    SELECT created_at, event_type, actor_role, payload
--      FROM public.supplier_order_activity
--      WHERE event_type IN ('quote_accepted','quote_declined','discussion_opened')
--      ORDER BY created_at DESC LIMIT 5;
--
-- 5) From a non-tenant-member session, calling any of these RPCs should
--    raise "Not authorized".

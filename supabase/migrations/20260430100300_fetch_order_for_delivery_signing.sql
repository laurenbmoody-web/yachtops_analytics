-- Sprint 9b Commit 5 — public RPC for the delivery signing page.
--
-- Anonymous users (the receiving crew on their phone, scanning the QR code
-- in the delivery note PDF) need read access to enough of the order to
-- know they're signing the right thing — order ref, vessel name, supplier
-- name, line items, delivery date/port. They also need to know if the
-- order has already been signed so the page can render the post-signing
-- "thanks, all done" state.
--
-- Rather than open up RLS on supplier_orders + supplier_order_items +
-- supplier_profiles for anon SELECT (which would force us to defend three
-- separate policies and accept that any token bearer can guess sibling
-- rows), we expose ONE SECURITY DEFINER RPC that takes the token and
-- returns a single JSON envelope.
--
-- Capability-URL semantics: the token is an unguessable 32-char random
-- string scoped to a single order. Possession of the token IS the
-- authorisation. The RPC returns NULL on unknown tokens — never leaks
-- which orders exist.
--
-- Implementation notes (from the working version Lauren tested live):
--   - The order envelope is built via to_jsonb(v_order) THEN stripped of
--     delivery_signing_token in a second statement. Inline subtraction
--     (to_jsonb(v_order) - 'delivery_signing_token') tripped a parser
--     edge case in the deployed Postgres.
--   - Items are aggregated via a subquery rather than a direct
--     jsonb_agg(jsonb_build_object(...) ORDER BY ...) — clearer plan,
--     and lets us project only the fields the signer needs to see.
--   - Items ordered by updated_at (created_at column doesn't exist on
--     supplier_order_items).
--   - Pricing intentionally excluded from the items projection: this is
--     a fulfilment confirmation, not a billing confirmation.
--
-- The supplementary edge function `signDeliveryNote` (Commit 6) writes the
-- actual signature back; this RPC is read-only.

CREATE OR REPLACE FUNCTION public.fetch_order_for_delivery_signing(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order        public.supplier_orders;
  v_supplier     public.supplier_profiles;
  v_items        jsonb;
  v_order_jsonb  jsonb;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_order
  FROM public.supplier_orders
  WHERE delivery_signing_token = p_token
  LIMIT 1;

  IF v_order.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Build the order envelope. Strip the signing token in a second statement
  -- so the wire payload never echoes back the capability secret — even
  -- though the caller already had it to make the request, returning it
  -- would be a needless surface.
  v_order_jsonb := to_jsonb(v_order);
  v_order_jsonb := v_order_jsonb - 'delivery_signing_token';

  SELECT * INTO v_supplier
  FROM public.supplier_profiles
  WHERE id = v_order.supplier_profile_id
  LIMIT 1;

  -- Project only the line-item fields the signer needs to confirm the
  -- delivery. Pricing intentionally omitted.
  SELECT COALESCE(jsonb_agg(row_to_json(i)::jsonb ORDER BY i.updated_at), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      id, item_name, quantity, unit, notes,
      substitute_description, status, quote_status, updated_at
    FROM public.supplier_order_items
    WHERE order_id = v_order.id
  ) i;

  RETURN jsonb_build_object(
    'order',    v_order_jsonb,
    'supplier', COALESCE(to_jsonb(v_supplier), 'null'::jsonb),
    'items',    v_items
  );
END;
$$;

-- Anon + authenticated may both call. Possession of a valid token is the
-- entire authorisation gate; un-tokenised callers get NULL via the early
-- length check (we don't even hit the table).
GRANT EXECUTE ON FUNCTION public.fetch_order_for_delivery_signing(text) TO anon, authenticated;

COMMENT ON FUNCTION public.fetch_order_for_delivery_signing(text) IS
  'Public read endpoint for the /delivery-sign/<token> capability URL. Returns order + items + supplier display fields, or NULL if the token is unknown. Pricing intentionally excluded — fulfilment confirmation only.';

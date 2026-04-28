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
-- The supplementary edge function `signDeliveryNote` (Commit 6) writes the
-- actual signature back; this RPC is read-only.

CREATE OR REPLACE FUNCTION public.fetch_order_for_delivery_signing(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order   public.supplier_orders%ROWTYPE;
  v_supplier_name        text;
  v_supplier_id          uuid;
  v_supplier_city        text;
  v_items                jsonb;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_order
  FROM public.supplier_orders
  WHERE delivery_signing_token = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Supplier display info
  SELECT id, name, business_city
    INTO v_supplier_id, v_supplier_name, v_supplier_city
  FROM public.supplier_profiles
  WHERE id = v_order.supplier_profile_id;

  -- Line items for the receipt — only the fields the signer needs to see.
  -- Pricing is intentionally omitted: this is a fulfilment confirmation,
  -- not a billing confirmation.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',                     i.id,
    'item_name',              i.item_name,
    'quantity',               i.quantity,
    'unit',                   i.unit,
    'notes',                  i.notes,
    'substitute_description', i.substitute_description,
    'status',                 i.status,
    'quote_status',           i.quote_status
  ) ORDER BY i.created_at), '[]'::jsonb)
    INTO v_items
  FROM public.supplier_order_items i
  WHERE i.order_id = v_order.id;

  RETURN jsonb_build_object(
    'order', jsonb_build_object(
      'id',                            v_order.id,
      'vessel_name',                   v_order.vessel_name,
      'delivery_date',                 v_order.delivery_date,
      'delivery_time',                 v_order.delivery_time,
      'delivery_port',                 v_order.delivery_port,
      'delivery_contact',              v_order.delivery_contact,
      'status',                        v_order.status,
      'crew_signed_at',                v_order.crew_signed_at,
      'crew_signer_name',              v_order.crew_signer_name,
      'delivery_note_generated_at',    v_order.delivery_note_generated_at
    ),
    'supplier', jsonb_build_object(
      'id',            v_supplier_id,
      'name',          v_supplier_name,
      'business_city', v_supplier_city
    ),
    'items', v_items
  );
END;
$$;

-- Anon + authenticated may both call. Possession of a valid token is the
-- entire authorisation gate; un-tokenised callers get NULL via the early
-- length check (we don't even hit the table).
GRANT EXECUTE ON FUNCTION public.fetch_order_for_delivery_signing(text) TO anon, authenticated;

COMMENT ON FUNCTION public.fetch_order_for_delivery_signing(text) IS
  'Public read endpoint for the /delivery-sign/<token> capability URL. Returns order + items + supplier display fields, or NULL if the token is unknown. Pricing intentionally excluded — fulfilment confirmation only.';

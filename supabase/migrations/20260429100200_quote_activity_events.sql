-- AFTER UPDATE trigger on supplier_order_items that writes activity log
-- entries for quote-workflow transitions. Mirrors the existing
-- log_supplier_order_changes trigger (on supplier_orders) and adds the
-- per-line events that the supplier order detail Activity card now
-- knows how to render.
--
-- Events surfaced:
--   quote_received    — supplier set quoted_price (auto_accepted flagged
--                       in the payload when the auto-accept trigger from
--                       Run BB also flipped quote_status to 'agreed' in
--                       the same UPDATE)
--   quote_accepted    — vessel explicitly accepted (status was quoted /
--                       in_discussion and quoted_price didn't change)
--   quote_declined    — vessel declined; previous quote captured in
--                       payload so the activity card can show what was
--                       refused
--   discussion_opened — vessel raised a query
--
-- Actor resolution: tries supplier_contacts first (any active row for
-- the calling user), then tenant_members. Falls back to actor_role =
-- 'system' when neither matches (e.g. service-role calls from edge
-- functions or migrations).

CREATE OR REPLACE FUNCTION public.log_supplier_order_item_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id    uuid;
  v_actor_contact_id uuid;
  v_actor_name       text;
  v_actor_role       text;
BEGIN
  v_actor_user_id := auth.uid();

  IF v_actor_user_id IS NOT NULL THEN
    SELECT id, name INTO v_actor_contact_id, v_actor_name
    FROM public.supplier_contacts
    WHERE user_id = v_actor_user_id
    LIMIT 1;

    IF v_actor_name IS NOT NULL THEN
      v_actor_role := 'supplier';
    ELSE
      -- Try the vessel side. tenant_members has no name column directly;
      -- fall back to profiles via user_id.
      SELECT COALESCE(p.full_name, p.email)
        INTO v_actor_name
      FROM public.tenant_members tm
      LEFT JOIN public.profiles p ON p.id = tm.user_id
      WHERE tm.user_id = v_actor_user_id
        AND tm.active = true
      LIMIT 1;

      v_actor_role := CASE WHEN v_actor_name IS NOT NULL THEN 'vessel' ELSE 'system' END;
    END IF;
  ELSE
    v_actor_role := 'system';
  END IF;

  -- ─── quote_received ────────────────────────────────────────────────
  -- Fires whenever the supplier sets / changes quoted_price. The
  -- auto_accepted flag tells the activity card whether this same UPDATE
  -- also resulted in agreement (so we don't double-log accept events).
  IF NEW.quoted_price IS DISTINCT FROM OLD.quoted_price
     AND NEW.quoted_price IS NOT NULL THEN
    INSERT INTO public.supplier_order_activity
      (order_id, item_id, event_type, actor_user_id, actor_supplier_contact_id,
       actor_name, actor_role, payload)
    VALUES (
      NEW.order_id, NEW.id, 'quote_received', v_actor_user_id, v_actor_contact_id,
      v_actor_name, v_actor_role,
      jsonb_build_object(
        'item_name',       NEW.item_name,
        'estimated_price', NEW.estimated_price,
        'quoted_price',    NEW.quoted_price,
        'quoted_currency', NEW.quoted_currency,
        'auto_accepted',   (NEW.quote_status = 'agreed')
      )
    );
  END IF;

  -- ─── quote_accepted ────────────────────────────────────────────────
  -- Vessel-driven accept: the price is unchanged from before, but
  -- quote_status moved from 'quoted' / 'in_discussion' to 'agreed'.
  -- Skips the auto-accept path (that already logged 'quote_received'
  -- with auto_accepted=true).
  IF NEW.quote_status = 'agreed'
     AND OLD.quote_status IN ('quoted', 'in_discussion')
     AND NEW.quoted_price IS NOT DISTINCT FROM OLD.quoted_price THEN
    INSERT INTO public.supplier_order_activity
      (order_id, item_id, event_type, actor_user_id, actor_supplier_contact_id,
       actor_name, actor_role, payload)
    VALUES (
      NEW.order_id, NEW.id, 'quote_accepted', v_actor_user_id, v_actor_contact_id,
      v_actor_name, v_actor_role,
      jsonb_build_object(
        'item_name',       NEW.item_name,
        'agreed_price',    NEW.agreed_price,
        'agreed_currency', NEW.agreed_currency,
        'estimated_price', NEW.estimated_price
      )
    );
  END IF;

  -- ─── quote_declined ────────────────────────────────────────────────
  IF NEW.quote_status = 'declined' AND OLD.quote_status <> 'declined' THEN
    INSERT INTO public.supplier_order_activity
      (order_id, item_id, event_type, actor_user_id, actor_supplier_contact_id,
       actor_name, actor_role, payload)
    VALUES (
      NEW.order_id, NEW.id, 'quote_declined', v_actor_user_id, v_actor_contact_id,
      v_actor_name, v_actor_role,
      jsonb_build_object(
        'item_name',             NEW.item_name,
        'declined_quoted_price', OLD.quoted_price,
        'declined_currency',     OLD.quoted_currency
      )
    );
  END IF;

  -- ─── discussion_opened ─────────────────────────────────────────────
  IF NEW.quote_status = 'in_discussion' AND OLD.quote_status <> 'in_discussion' THEN
    INSERT INTO public.supplier_order_activity
      (order_id, item_id, event_type, actor_user_id, actor_supplier_contact_id,
       actor_name, actor_role, payload)
    VALUES (
      NEW.order_id, NEW.id, 'discussion_opened', v_actor_user_id, v_actor_contact_id,
      v_actor_name, v_actor_role,
      jsonb_build_object('item_name', NEW.item_name)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_order_item_changes_log ON public.supplier_order_items;
CREATE TRIGGER supplier_order_item_changes_log
  AFTER UPDATE ON public.supplier_order_items
  FOR EACH ROW EXECUTE FUNCTION public.log_supplier_order_item_changes();

COMMENT ON FUNCTION public.log_supplier_order_item_changes IS
  'AFTER UPDATE on supplier_order_items: writes quote_received / quote_accepted / quote_declined / discussion_opened events to supplier_order_activity. Resolves actor as supplier (supplier_contacts) → vessel (tenant_members + profiles) → system fallback.';

-- ─── Verification queries (run after apply) ──────────────────────────────
--
-- After Run BB's smoke test (UPDATE quoted_price = estimated_price),
-- check that a quote_received event landed:
--
--   SELECT created_at, event_type, actor_role, actor_name, payload
--     FROM public.supplier_order_activity
--     WHERE event_type IN ('quote_received','quote_accepted','quote_declined','discussion_opened')
--     ORDER BY created_at DESC
--     LIMIT 5;

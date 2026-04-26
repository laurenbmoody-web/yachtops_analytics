-- Activity log for supplier_orders.
--
-- Captures lifecycle events (order received, status advanced, delivery edited,
-- reassigned, item confirmed/substituted/unavailable). Future use cases:
-- threaded messages, returns events, document attachments.

CREATE TABLE IF NOT EXISTS public.supplier_order_activity (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                    uuid NOT NULL REFERENCES public.supplier_orders(id) ON DELETE CASCADE,
  event_type                  text NOT NULL,
  -- examples:
  --   'order_received'        — system event, fired when supplier_orders row created
  --   'delivery_edited'       — payload: {fields_changed: [...], before: {...}, after: {...}}
  --   'reassigned'            — payload: {from_contact_id, to_contact_id}
  --   'status_advanced'       — payload: {from, to}
  --   'item_confirmed'        — payload: {item_id, item_name}
  --   'item_substituted'      — payload: {item_id, item_name, substitute_description}
  --   'item_unavailable'      — payload: {item_id, item_name}
  --   'message'               — payload: {body}, item_id optional for per-line threads
  actor_user_id               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_supplier_contact_id   uuid REFERENCES public.supplier_contacts(id) ON DELETE SET NULL,
  actor_name                  text,         -- denormalised for display even if contact deleted
  actor_role                  text,         -- 'supplier' | 'vessel' | 'system'
  item_id                     uuid REFERENCES public.supplier_order_items(id) ON DELETE CASCADE,
  payload                     jsonb DEFAULT '{}'::jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS supplier_order_activity_order_idx
  ON public.supplier_order_activity(order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS supplier_order_activity_item_idx
  ON public.supplier_order_activity(item_id)
  WHERE item_id IS NOT NULL;

ALTER TABLE public.supplier_order_activity ENABLE ROW LEVEL SECURITY;

-- Supplier members can read activity for orders belonging to their supplier
CREATE POLICY "supplier_read_own_order_activity"
  ON public.supplier_order_activity
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.supplier_orders so
      WHERE so.id = supplier_order_activity.order_id
        AND so.supplier_profile_id = public.get_user_supplier_id()
    )
  );

-- Inserts go through helper RPCs (SECURITY DEFINER); direct inserts not allowed
-- except by the trigger functions which run as the table owner.

COMMENT ON TABLE public.supplier_order_activity IS
  'Append-only activity log for supplier orders. Events written by triggers and helper RPCs.';

-- ─── Trigger: log delivery edits, reassigns, status advances ─────────────

CREATE OR REPLACE FUNCTION public.log_supplier_order_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_contact_id uuid;
  v_actor_name text;
  v_changed_fields text[] := ARRAY[]::text[];
  v_before jsonb := '{}'::jsonb;
  v_after  jsonb := '{}'::jsonb;
BEGIN
  -- Resolve the current user → supplier_contact for actor metadata
  SELECT id, name INTO v_actor_contact_id, v_actor_name
  FROM public.supplier_contacts
  WHERE user_id = auth.uid()
  LIMIT 1;

  -- Reassignment
  IF NEW.assigned_to_supplier_contact_id IS DISTINCT FROM OLD.assigned_to_supplier_contact_id THEN
    INSERT INTO public.supplier_order_activity
      (order_id, event_type, actor_user_id, actor_supplier_contact_id, actor_name, actor_role, payload)
    VALUES (
      NEW.id, 'reassigned', auth.uid(), v_actor_contact_id, v_actor_name, 'supplier',
      jsonb_build_object(
        'from_contact_id', OLD.assigned_to_supplier_contact_id,
        'to_contact_id',   NEW.assigned_to_supplier_contact_id
      )
    );
  END IF;

  -- Delivery edits — collect changed fields
  IF NEW.delivery_date IS DISTINCT FROM OLD.delivery_date THEN
    v_changed_fields := array_append(v_changed_fields, 'delivery_date');
    v_before := v_before || jsonb_build_object('delivery_date', OLD.delivery_date);
    v_after  := v_after  || jsonb_build_object('delivery_date', NEW.delivery_date);
  END IF;
  IF NEW.delivery_time IS DISTINCT FROM OLD.delivery_time THEN
    v_changed_fields := array_append(v_changed_fields, 'delivery_time');
    v_before := v_before || jsonb_build_object('delivery_time', OLD.delivery_time);
    v_after  := v_after  || jsonb_build_object('delivery_time', NEW.delivery_time);
  END IF;
  IF NEW.delivery_port IS DISTINCT FROM OLD.delivery_port THEN
    v_changed_fields := array_append(v_changed_fields, 'delivery_port');
    v_before := v_before || jsonb_build_object('delivery_port', OLD.delivery_port);
    v_after  := v_after  || jsonb_build_object('delivery_port', NEW.delivery_port);
  END IF;
  IF NEW.delivery_contact IS DISTINCT FROM OLD.delivery_contact THEN
    v_changed_fields := array_append(v_changed_fields, 'delivery_contact');
    v_before := v_before || jsonb_build_object('delivery_contact', OLD.delivery_contact);
    v_after  := v_after  || jsonb_build_object('delivery_contact', NEW.delivery_contact);
  END IF;

  IF array_length(v_changed_fields, 1) > 0 THEN
    INSERT INTO public.supplier_order_activity
      (order_id, event_type, actor_user_id, actor_supplier_contact_id, actor_name, actor_role, payload)
    VALUES (
      NEW.id, 'delivery_edited', auth.uid(), v_actor_contact_id, v_actor_name, 'supplier',
      jsonb_build_object(
        'fields_changed', v_changed_fields,
        'before', v_before,
        'after',  v_after
      )
    );
  END IF;

  -- Status advances
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.supplier_order_activity
      (order_id, event_type, actor_user_id, actor_supplier_contact_id, actor_name, actor_role, payload)
    VALUES (
      NEW.id, 'status_advanced', auth.uid(), v_actor_contact_id, v_actor_name, 'supplier',
      jsonb_build_object('from', OLD.status, 'to', NEW.status)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_order_changes_log ON public.supplier_orders;
CREATE TRIGGER supplier_order_changes_log
  AFTER UPDATE ON public.supplier_orders
  FOR EACH ROW EXECUTE FUNCTION public.log_supplier_order_changes();

-- Seed: write 'order_received' event for every existing order that doesn't
-- already have one.
INSERT INTO public.supplier_order_activity
  (order_id, event_type, actor_role, created_at, payload)
SELECT
  id, 'order_received', 'system', created_at,
  jsonb_build_object('vessel_name', vessel_name, 'sent_via', sent_via)
FROM public.supplier_orders
WHERE NOT EXISTS (
  SELECT 1 FROM public.supplier_order_activity sa
  WHERE sa.order_id = supplier_orders.id AND sa.event_type = 'order_received'
);

-- Trigger: also write 'order_received' for newly inserted orders going forward.
CREATE OR REPLACE FUNCTION public.log_supplier_order_received()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.supplier_order_activity
    (order_id, event_type, actor_role, payload)
  VALUES (
    NEW.id, 'order_received', 'system',
    jsonb_build_object('vessel_name', NEW.vessel_name, 'sent_via', NEW.sent_via)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_order_received_log ON public.supplier_orders;
CREATE TRIGGER supplier_order_received_log
  AFTER INSERT ON public.supplier_orders
  FOR EACH ROW EXECUTE FUNCTION public.log_supplier_order_received();

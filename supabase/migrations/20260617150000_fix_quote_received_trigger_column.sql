-- ─────────────────────────────────────────────────────────────────────────────
-- 20260617150000_fix_quote_received_trigger_column.sql
--
-- The handle_supplier_quote_for_list_status trigger (from
-- 20260617221000_provisioning_quote_received_status.sql) references
-- NEW.supplier_order_id when walking the supplier_order_items row up
-- to its parent supplier_orders row. That column doesn't exist on
-- supplier_order_items — the parent FK is named `order_id` (see the
-- original supplier_orders migration, 20260417300000). The mismatch
-- only surfaces at runtime when a supplier confirms a line in the
-- portal: PATCH returns 400 with
--   record "new" has no field "supplier_order_id"
-- and the confirm flow blocks.
--
-- Fix: redefine the function using NEW.order_id. Trigger binding is
-- untouched (DROP/CREATE handled by the original migration). Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_supplier_quote_for_list_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_list_id uuid;
BEGIN
  IF NEW.quoted_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.quoted_at IS NOT DISTINCT FROM NEW.quoted_at THEN
    RETURN NEW;
  END IF;

  SELECT so.list_id INTO v_list_id
  FROM public.supplier_orders so
  WHERE so.id = NEW.order_id;

  IF v_list_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.provisioning_lists
     SET status     = 'quote_received',
         updated_at = now()
   WHERE id = v_list_id
     AND status = 'sent_to_supplier';

  RETURN NEW;
END;
$function$;

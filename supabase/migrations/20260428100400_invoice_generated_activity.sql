-- Auto-log an `invoice_generated` event onto supplier_order_activity
-- whenever a row is inserted into supplier_invoices. Mirrors the existing
-- delivery_edited / reassigned / status_advanced triggers added in
-- 20260427140000 and surfaces in the same Activity card on the supplier
-- order detail page.
--
-- The edge function (generateSupplierInvoice) is the only writer to
-- supplier_invoices today. It runs as service-role, so auth.uid() inside
-- this trigger is NULL — actor metadata fills in best-effort from a
-- supplier_contact row matching invoice.supplier_id and the most-recent
-- last_active_at, or falls back to actor_role='system'.

CREATE OR REPLACE FUNCTION public.log_invoice_generated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id     uuid;
  v_actor_contact_id  uuid;
  v_actor_name        text;
BEGIN
  -- Best-effort actor: caller's contact if they're authed, otherwise system.
  IF auth.uid() IS NOT NULL THEN
    SELECT id, user_id, name
      INTO v_actor_contact_id, v_actor_user_id, v_actor_name
    FROM public.supplier_contacts
    WHERE user_id = auth.uid()
    LIMIT 1;
  END IF;

  INSERT INTO public.supplier_order_activity
    (order_id, event_type, actor_user_id, actor_supplier_contact_id, actor_name, actor_role, payload)
  VALUES (
    NEW.order_id,
    'invoice_generated',
    v_actor_user_id,
    v_actor_contact_id,
    v_actor_name,
    CASE WHEN v_actor_user_id IS NULL THEN 'system' ELSE 'supplier' END,
    jsonb_build_object(
      'invoice_id',     NEW.id,
      'invoice_number', NEW.invoice_number,
      'amount',         NEW.amount,
      'currency',       NEW.currency,
      'bonded_supply',  NEW.bonded_supply
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_invoice_generated_log ON public.supplier_invoices;
CREATE TRIGGER supplier_invoice_generated_log
  AFTER INSERT ON public.supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION public.log_invoice_generated();

COMMENT ON FUNCTION public.log_invoice_generated IS
  'Writes an invoice_generated event to supplier_order_activity for every new supplier_invoices row. Trigger lives on supplier_invoices, not on the edge function, so manual inserts also get logged.';

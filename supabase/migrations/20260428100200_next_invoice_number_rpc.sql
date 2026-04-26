-- Atomically increments the supplier's invoice counter and returns the
-- next formatted invoice number. EU/UK invoicing law requires gap-free
-- sequential numbering per supplier — a single UPDATE ... RETURNING gives
-- us atomicity without a separate locking strategy.

CREATE OR REPLACE FUNCTION public.next_invoice_number(p_supplier_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next integer;
  v_format text;
  v_prefix text;
  v_result text;
  v_year text;
  v_year_short text;
  v_month text;
BEGIN
  -- Atomic increment + return new value
  UPDATE public.supplier_profiles
  SET invoice_number_counter = COALESCE(invoice_number_counter, 0) + 1
  WHERE id = p_supplier_id
  RETURNING
    invoice_number_counter,
    COALESCE(invoice_number_format, '{prefix}-{YYYY}-{####}'),
    COALESCE(invoice_number_prefix, 'INV')
  INTO v_next, v_format, v_prefix;

  IF v_next IS NULL THEN
    RAISE EXCEPTION 'Supplier % not found or counter could not be incremented', p_supplier_id;
  END IF;

  v_year       := to_char(now(), 'YYYY');
  v_year_short := to_char(now(), 'YY');
  v_month      := to_char(now(), 'MM');

  v_result := v_format;
  v_result := replace(v_result, '{prefix}', v_prefix);
  v_result := replace(v_result, '{YYYY}',   v_year);
  v_result := replace(v_result, '{YY}',     v_year_short);
  v_result := replace(v_result, '{MM}',     v_month);
  v_result := replace(v_result, '{####}',   lpad(v_next::text, 4, '0'));
  v_result := replace(v_result, '{###}',    lpad(v_next::text, 3, '0'));
  v_result := replace(v_result, '{#####}',  lpad(v_next::text, 5, '0'));

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_invoice_number(uuid) TO authenticated;

-- Supplier saves their own storefront fields. A direct table UPDATE from
-- the portal hits "permission denied for table supplier_profiles", so —
-- matching the rest of the supplier side — this goes through a
-- SECURITY DEFINER RPC gated on get_user_supplier_id().

create or replace function public.update_supplier_storefront(
  p_lead_time_days     integer,
  p_order_cutoff       time,
  p_min_order_value    numeric,
  p_min_order_currency text,
  p_certifications     text[],
  p_express_available  boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_supplier uuid;
begin
  v_supplier := public.get_user_supplier_id();
  if v_supplier is null then
    raise exception 'not a supplier user';
  end if;

  update public.supplier_profiles
     set lead_time_days     = p_lead_time_days,
         order_cutoff       = p_order_cutoff,
         min_order_value    = p_min_order_value,
         min_order_currency = coalesce(nullif(btrim(coalesce(p_min_order_currency, '')), ''), 'EUR'),
         certifications     = coalesce(p_certifications, '{}'),
         express_available  = coalesce(p_express_available, false)
   where id = v_supplier;
end;
$$;

grant execute on function public.update_supplier_storefront(integer, time, numeric, text, text[], boolean) to authenticated;

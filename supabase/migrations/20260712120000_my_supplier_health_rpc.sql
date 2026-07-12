-- A supplier's own reputation at a glance — orders filled, on-time %, and
-- response time, from real order history. Mirrors the buyer-facing
-- get_marketplace_supplier_stats, but gated on get_user_supplier_id() so a
-- supplier user (not a tenant member) can see their own numbers.

create or replace function public.get_my_supplier_health()
returns table (
  orders_count       bigint,
  orders_fulfilled   bigint,
  on_time_eligible   bigint,
  on_time_count      bigint,
  avg_response_hours numeric,
  last_order_at      timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*),
    count(*) filter (
      where o.status in ('confirmed','partially_confirmed','picking','packed',
                         'dispatched','out_for_delivery','received','delivered',
                         'delivered_with_discrepancies','completed','invoiced','paid')
    ),
    count(*) filter (
      where o.crew_signed_at is not null and o.delivery_date is not null
    ),
    count(*) filter (
      where o.crew_signed_at is not null and o.delivery_date is not null
        and (o.crew_signed_at at time zone 'UTC')::date <= o.delivery_date
    ),
    round(
      avg(extract(epoch from (o.confirmed_at - o.sent_at)) / 3600.0)
        filter (where o.sent_at is not null and o.confirmed_at is not null
                  and o.confirmed_at >= o.sent_at)
    , 1),
    max(o.created_at)
  from public.supplier_orders o
  where o.supplier_profile_id = public.get_user_supplier_id();
$$;

grant execute on function public.get_my_supplier_health() to authenticated;

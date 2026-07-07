-- Marketplace supplier KPIs — honest numbers only.
--
-- The Providers wall (marketplace step i) shows a small trust trio per
-- shop: orders filled, on-time %, and typical response time. All three
-- are derived from real order history in supplier_orders — nothing is
-- invented. Where a supplier has no history the caller renders a
-- "New to Cargo" state instead of a fake 0%.
--
-- Definitions:
--   orders_count      every order ever sent to this supplier profile
--   orders_fulfilled  reached confirmed → dispatched → delivered → completed
--   on_time_eligible  delivered (crew-signed) orders that carried a
--                     promised delivery_date — the only rows we can
--                     honestly grade for punctuality
--   on_time_count     of those, delivered on or before the promised date
--   avg_response_hours mean hours from sent_at → confirmed_at (how fast
--                     the supplier accepts an order)
--   last_order_at     most recent order, for a "last active" hint
--
-- SECURITY DEFINER + the same "caller is an active crew member"
-- gate as get_marketplace_suppliers(): stats are aggregate and carry no
-- other tenant's private detail, but we still refuse anonymous callers.

create or replace function public.get_marketplace_supplier_stats()
returns table (
  supplier_profile_id uuid,
  orders_count        bigint,
  orders_fulfilled    bigint,
  on_time_eligible    bigint,
  on_time_count       bigint,
  avg_response_hours  numeric,
  last_order_at       timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.supplier_profile_id,
    count(*)                                                as orders_count,
    count(*) filter (
      where o.status in ('confirmed','partially_confirmed','picking',
                         'packed','dispatched','delivered',
                         'delivered_with_discrepancies','completed')
    )                                                       as orders_fulfilled,
    count(*) filter (
      where o.crew_signed_at is not null and o.delivery_date is not null
    )                                                       as on_time_eligible,
    count(*) filter (
      where o.crew_signed_at is not null and o.delivery_date is not null
        and (o.crew_signed_at at time zone 'UTC')::date <= o.delivery_date
    )                                                       as on_time_count,
    round(
      avg(extract(epoch from (o.confirmed_at - o.sent_at)) / 3600.0)
        filter (where o.sent_at is not null and o.confirmed_at is not null
                  and o.confirmed_at >= o.sent_at)
    , 1)                                                    as avg_response_hours,
    max(o.created_at)                                       as last_order_at
  from public.supplier_orders o
  where o.supplier_profile_id is not null
    and exists (
      select 1 from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true
    )
  group by o.supplier_profile_id;
$$;

grant execute on function public.get_marketplace_supplier_stats() to authenticated;

comment on function public.get_marketplace_supplier_stats() is
  'Aggregate marketplace trust KPIs per supplier profile (orders filled, on-time %, response time), derived from supplier_orders. Powers the Providers wall.';

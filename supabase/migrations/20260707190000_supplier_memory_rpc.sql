-- Supplier memory — the caller's tenant's own history with each supplier.
--
-- Powers the deck card's hover-flip KPIs (your orders, your spend, when
-- you last ordered) and orders the supply chips by what this tenant
-- actually orders most from that supplier. Tenant-scoped: only the
-- caller's tenant's orders are aggregated (SECURITY DEFINER + a
-- tenant_members match on the order's tenant_id).
--
-- Spend uses the best price available per line (invoiced → agreed →
-- quoted → unit → estimated) × quantity, so it works whether an order
-- was invoiced or is still at estimate.

create or replace function public.get_supplier_memory()
returns table (
  supplier_profile_id uuid,
  orders_count        bigint,
  total_spend         numeric,
  currency            text,
  last_order_at       timestamptz,
  top_categories      text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with my_orders as (
    select o.id, o.supplier_profile_id, o.created_at, o.currency
    from public.supplier_orders o
    where o.supplier_profile_id is not null
      and exists (
        select 1 from public.tenant_members tm
        where tm.user_id = auth.uid() and tm.active and tm.tenant_id = o.tenant_id
      )
  ),
  lines as (
    select oi.order_id, oi.category,
      coalesce(oi.invoiced_price, oi.agreed_price, oi.quoted_price, oi.unit_price, oi.estimated_price, 0)
        * coalesce(oi.quantity, 0) as line_total
    from public.supplier_order_items oi
    where oi.order_id in (select id from my_orders)
  ),
  spend as (
    select mo.supplier_profile_id,
      count(distinct mo.id) as orders_count,
      round(coalesce(sum(l.line_total), 0)::numeric, 2) as total_spend,
      max(mo.created_at) as last_order_at,
      (array_agg(mo.currency order by mo.created_at desc))[1] as currency
    from my_orders mo left join lines l on l.order_id = mo.id
    group by mo.supplier_profile_id
  ),
  cat_counts as (
    select mo.supplier_profile_id, l.category, count(*) as c
    from my_orders mo join lines l on l.order_id = mo.id
    where l.category is not null and l.category <> ''
    group by mo.supplier_profile_id, l.category
  ),
  cat_ranked as (
    select supplier_profile_id, (array_agg(category order by c desc))[1:6] as top_categories
    from cat_counts group by supplier_profile_id
  )
  select s.supplier_profile_id, s.orders_count, s.total_spend, s.currency, s.last_order_at,
    coalesce(c.top_categories, '{}') as top_categories
  from spend s
  left join cat_ranked c on c.supplier_profile_id = s.supplier_profile_id;
$$;

grant execute on function public.get_supplier_memory() to authenticated;

comment on function public.get_supplier_memory() is
  'Per-supplier history for the caller''s tenant (order count, spend, last order, most-ordered categories). Powers the marketplace deck card flip and chip ordering.';

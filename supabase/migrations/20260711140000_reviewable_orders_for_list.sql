-- Reviewable delivered orders on ONE board (provisioning list) — powers
-- the "rate this delivery" prompt that fires when crew receive a board's
-- delivery. Same verified gating as get_reviewable_orders, scoped to the
-- list and carrying the supplier name so the prompt can address it.

create or replace function public.get_reviewable_orders_for_list(p_list_id uuid)
returns table (
  order_id        uuid,
  supplier_id     uuid,
  supplier_name   text,
  delivery_date   date,
  delivery_port   text,
  list_title      text,
  rating          int,
  note            text,
  quality_rating  int,
  delivery_rating int,
  service_rating  int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.id,
    o.supplier_profile_id,
    coalesce(sp.name, o.supplier_name),
    o.delivery_date,
    o.delivery_port,
    pl.title,
    r.rating,
    r.note,
    r.quality_rating,
    r.delivery_rating,
    r.service_rating
  from public.supplier_orders o
  join public.provisioning_lists pl on pl.id = o.list_id
  left join public.supplier_profiles sp on sp.id = o.supplier_profile_id
  left join public.supplier_reviews r on r.order_id = o.id
  where o.list_id = p_list_id
    and o.supplier_profile_id is not null
    and public.is_active_tenant_member(o.tenant_id, auth.uid())
    and public.supplier_order_is_delivered(o)
  order by coalesce(o.crew_signed_at, o.created_at) desc;
$$;

grant execute on function public.get_reviewable_orders_for_list(uuid) to authenticated;

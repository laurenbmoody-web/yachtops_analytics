-- Multi-criteria supplier reviews.
--
-- The overall star stays the headline (simple marketplace score). On top
-- of it, three OPTIONAL sub-ratings give suppliers something actionable —
-- a supplier can have great produce but chronically late vans, and one
-- number hides that:
--   • Quality  — condition / freshness of the goods
--   • Delivery — on time, packed well, right quantities
--   • Service  — communication, responsiveness, sorting problems out
--
-- Sub-ratings are nullable (a rushed reviewer just taps overall). The read
-- RPCs return per-review sub-scores and per-supplier sub-averages.

alter table public.supplier_reviews
  add column if not exists quality_rating  smallint check (quality_rating  between 1 and 5),
  add column if not exists delivery_rating smallint check (delivery_rating between 1 and 5),
  add column if not exists service_rating  smallint check (service_rating  between 1 and 5);

-- ── Write: overall required, Quality/Delivery/Service optional ───────
drop function if exists public.submit_order_review(uuid, int, text);
create or replace function public.submit_order_review(
  p_order_id uuid, p_rating int, p_note text default null,
  p_quality int default null, p_delivery int default null, p_service int default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_order public.supplier_orders;
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'rating must be between 1 and 5';
  end if;

  select * into v_order from public.supplier_orders where id = p_order_id;
  if not found then
    raise exception 'order not found';
  end if;

  if not public.is_active_tenant_member(v_order.tenant_id, auth.uid()) then
    raise exception 'not an active crew member of this vessel';
  end if;

  if not public.supplier_order_is_delivered(v_order) then
    raise exception 'you can only review a delivered order';
  end if;

  if v_order.supplier_profile_id is null then
    raise exception 'this order has no marketplace supplier to review';
  end if;

  insert into public.supplier_reviews
      (order_id, supplier_id, tenant_id, vessel_name, user_id, rating, note,
       quality_rating, delivery_rating, service_rating)
  values
      (p_order_id, v_order.supplier_profile_id, v_order.tenant_id, v_order.vessel_name,
       auth.uid(), p_rating, nullif(btrim(coalesce(p_note, '')), ''),
       p_quality, p_delivery, p_service)
  on conflict (order_id) do update
     set rating          = excluded.rating,
         note            = excluded.note,
         quality_rating  = excluded.quality_rating,
         delivery_rating = excluded.delivery_rating,
         service_rating  = excluded.service_rating,
         user_id         = excluded.user_id,
         updated_at      = now();
end;
$$;
grant execute on function public.submit_order_review(uuid, int, text, int, int, int) to authenticated;

-- ── Crew read: reviewable orders (+ existing sub-scores to pre-fill) ─
drop function if exists public.get_reviewable_orders(uuid);
create or replace function public.get_reviewable_orders(p_supplier_id uuid)
returns table (
  order_id        uuid,
  delivery_date   date,
  delivery_port   text,
  list_title      text,
  ordered_at      timestamptz,
  rating          int,
  note            text,
  reviewed_at     timestamptz,
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
    o.delivery_date,
    o.delivery_port,
    pl.title,
    coalesce(o.crew_signed_at, o.created_at),
    r.rating,
    r.note,
    r.updated_at,
    r.quality_rating,
    r.delivery_rating,
    r.service_rating
  from public.supplier_orders o
  join public.provisioning_lists pl on pl.id = o.list_id
  left join public.supplier_reviews r on r.order_id = o.id
  where o.supplier_profile_id = p_supplier_id
    and public.is_active_tenant_member(o.tenant_id, auth.uid())
    and public.supplier_order_is_delivered(o)
  order by coalesce(o.crew_signed_at, o.created_at) desc;
$$;
grant execute on function public.get_reviewable_orders(uuid) to authenticated;

-- ── Buyer read: average + count + sub-averages ───────────────────────
drop function if exists public.get_supplier_ratings();
create or replace function public.get_supplier_ratings()
returns table (
  supplier_id  uuid,
  avg_rating   numeric,
  rating_count bigint,
  avg_quality  numeric,
  avg_delivery numeric,
  avg_service  numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.supplier_id,
    round(avg(r.rating)::numeric, 1)          as avg_rating,
    count(*)::bigint                           as rating_count,
    round(avg(r.quality_rating)::numeric, 1)  as avg_quality,
    round(avg(r.delivery_rating)::numeric, 1) as avg_delivery,
    round(avg(r.service_rating)::numeric, 1)  as avg_service
  from public.supplier_reviews r
  where exists (
    select 1 from public.tenant_members tm
    where tm.user_id = auth.uid() and tm.active = true
  )
  group by r.supplier_id;
$$;
grant execute on function public.get_supplier_ratings() to authenticated;

-- ── Buyer read: verified reviews list (+ sub-scores) ─────────────────
drop function if exists public.get_supplier_reviews(uuid);
create or replace function public.get_supplier_reviews(p_supplier_id uuid)
returns table (
  id              uuid,
  rating          int,
  note            text,
  created_at      timestamptz,
  supplier_reply  text,
  replied_at      timestamptz,
  is_mine         boolean,
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
    r.id,
    r.rating,
    r.note,
    r.created_at,
    r.supplier_reply,
    r.replied_at,
    (r.user_id = auth.uid() or public.is_active_tenant_member(r.tenant_id, auth.uid())) as is_mine,
    r.quality_rating,
    r.delivery_rating,
    r.service_rating
  from public.supplier_reviews r
  where r.supplier_id = p_supplier_id
    and nullif(btrim(coalesce(r.note, '')), '') is not null
    and exists (
      select 1 from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true
    )
  order by r.created_at desc;
$$;
grant execute on function public.get_supplier_reviews(uuid) to authenticated;

-- ── Supplier read: my reviews (+ sub-scores), traceable to order ─────
drop function if exists public.get_my_supplier_reviews();
create or replace function public.get_my_supplier_reviews()
returns table (
  id              uuid,
  order_id        uuid,
  vessel_name     text,
  delivery_date   date,
  rating          int,
  note            text,
  created_at      timestamptz,
  supplier_reply  text,
  replied_at      timestamptz,
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
    r.id,
    r.order_id,
    coalesce(r.vessel_name, o.vessel_name) as vessel_name,
    o.delivery_date,
    r.rating,
    r.note,
    r.created_at,
    r.supplier_reply,
    r.replied_at,
    r.quality_rating,
    r.delivery_rating,
    r.service_rating
  from public.supplier_reviews r
  join public.supplier_orders o on o.id = r.order_id
  where r.supplier_id = public.get_user_supplier_id()
  order by r.created_at desc;
$$;
grant execute on function public.get_my_supplier_reviews() to authenticated;

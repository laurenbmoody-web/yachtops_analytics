-- Half-star ratings. Overall + Quality/Delivery/Service move from integer
-- to numeric(2,1) so crew can give 3.5★, and averages render on the
-- half. Values are constrained to 0.5-step increments in [0.5, 5].
--
-- Every read RPC that returned these as int is recreated to return
-- numeric (int return columns would silently truncate the .5), and the
-- write RPC takes numeric.

-- ── 1. Columns → numeric(2,1) with half-step constraints ─────────────
alter table public.supplier_reviews
  drop constraint if exists supplier_reviews_rating_check,
  drop constraint if exists supplier_reviews_quality_rating_check,
  drop constraint if exists supplier_reviews_delivery_rating_check,
  drop constraint if exists supplier_reviews_service_rating_check;

alter table public.supplier_reviews
  alter column rating          type numeric(2,1) using rating::numeric(2,1),
  alter column quality_rating  type numeric(2,1) using quality_rating::numeric(2,1),
  alter column delivery_rating type numeric(2,1) using delivery_rating::numeric(2,1),
  alter column service_rating  type numeric(2,1) using service_rating::numeric(2,1);

alter table public.supplier_reviews
  drop constraint if exists supplier_reviews_ratings_range_chk;
alter table public.supplier_reviews
  add constraint supplier_reviews_ratings_range_chk check (
        rating between 0.5 and 5 and (rating * 2) = trunc(rating * 2)
    and (quality_rating  is null or (quality_rating  between 0.5 and 5 and (quality_rating  * 2) = trunc(quality_rating  * 2)))
    and (delivery_rating is null or (delivery_rating between 0.5 and 5 and (delivery_rating * 2) = trunc(delivery_rating * 2)))
    and (service_rating  is null or (service_rating  between 0.5 and 5 and (service_rating  * 2) = trunc(service_rating  * 2)))
  );

-- ── 2. Write RPC: numeric params ─────────────────────────────────────
drop function if exists public.submit_order_review(uuid, int, text, int, int, int);
create or replace function public.submit_order_review(
  p_order_id uuid, p_rating numeric, p_note text default null,
  p_quality numeric default null, p_delivery numeric default null, p_service numeric default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_order public.supplier_orders;
begin
  if p_rating is null or p_rating < 0.5 or p_rating > 5 then
    raise exception 'rating must be between 0.5 and 5';
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
grant execute on function public.submit_order_review(uuid, numeric, text, numeric, numeric, numeric) to authenticated;

-- ── 3. Read RPCs → numeric rating columns ────────────────────────────
drop function if exists public.get_reviewable_orders(uuid);
create or replace function public.get_reviewable_orders(p_supplier_id uuid)
returns table (
  order_id        uuid,
  delivery_date   date,
  delivery_port   text,
  list_title      text,
  ordered_at      timestamptz,
  rating          numeric,
  note            text,
  reviewed_at     timestamptz,
  quality_rating  numeric,
  delivery_rating numeric,
  service_rating  numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.id, o.delivery_date, o.delivery_port, pl.title,
    coalesce(o.crew_signed_at, o.created_at),
    r.rating, r.note, r.updated_at,
    r.quality_rating, r.delivery_rating, r.service_rating
  from public.supplier_orders o
  join public.provisioning_lists pl on pl.id = o.list_id
  left join public.supplier_reviews r on r.order_id = o.id
  where o.supplier_profile_id = p_supplier_id
    and public.is_active_tenant_member(o.tenant_id, auth.uid())
    and public.supplier_order_is_delivered(o)
  order by coalesce(o.crew_signed_at, o.created_at) desc;
$$;
grant execute on function public.get_reviewable_orders(uuid) to authenticated;

drop function if exists public.get_supplier_reviews(uuid);
create or replace function public.get_supplier_reviews(p_supplier_id uuid)
returns table (
  id              uuid,
  rating          numeric,
  note            text,
  created_at      timestamptz,
  supplier_reply  text,
  replied_at      timestamptz,
  is_mine         boolean,
  quality_rating  numeric,
  delivery_rating numeric,
  service_rating  numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id, r.rating, r.note, r.created_at, r.supplier_reply, r.replied_at,
    (r.user_id = auth.uid() or public.is_active_tenant_member(r.tenant_id, auth.uid())),
    r.quality_rating, r.delivery_rating, r.service_rating
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

drop function if exists public.get_my_supplier_reviews();
create or replace function public.get_my_supplier_reviews()
returns table (
  id              uuid,
  order_id        uuid,
  vessel_name     text,
  delivery_date   date,
  rating          numeric,
  note            text,
  created_at      timestamptz,
  supplier_reply  text,
  replied_at      timestamptz,
  quality_rating  numeric,
  delivery_rating numeric,
  service_rating  numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id, r.order_id, coalesce(r.vessel_name, o.vessel_name), o.delivery_date,
    r.rating, r.note, r.created_at, r.supplier_reply, r.replied_at,
    r.quality_rating, r.delivery_rating, r.service_rating
  from public.supplier_reviews r
  join public.supplier_orders o on o.id = r.order_id
  where r.supplier_id = public.get_user_supplier_id()
  order by r.created_at desc;
$$;
grant execute on function public.get_my_supplier_reviews() to authenticated;

drop function if exists public.get_reviewable_orders_for_list(uuid);
create or replace function public.get_reviewable_orders_for_list(p_list_id uuid)
returns table (
  order_id        uuid,
  supplier_id     uuid,
  supplier_name   text,
  delivery_date   date,
  delivery_port   text,
  list_title      text,
  rating          numeric,
  note            text,
  quality_rating  numeric,
  delivery_rating numeric,
  service_rating  numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.id, o.supplier_profile_id, coalesce(sp.name, o.supplier_name),
    o.delivery_date, o.delivery_port, pl.title,
    r.rating, r.note, r.quality_rating, r.delivery_rating, r.service_rating
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

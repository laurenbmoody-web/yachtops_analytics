-- Verified, per-delivered-order supplier reviews.
--
-- A review now belongs to a *delivered order* (supplier_orders), not to a
-- supplier in the abstract. That means:
--   • Only a vessel that actually received an order can review it
--     ("verified — ordered via Cargo"), gated on crew_signed_at / status.
--   • One review per delivered order (the vessel's verdict on that
--     delivery), editable by the vessel's crew.
--   • The supplier can trace a review to its order + vessel and post a
--     public reply to offer support — anonymous to other buyers, but
--     visible to the supplier who fulfilled it (their own customer).
--
-- The old model (one ungated rating per user per supplier) is retired:
-- those rows are cleared and the write RPC (rate_supplier) is dropped.

-- ── 1. Retire the ungated ratings ────────────────────────────────────
delete from public.supplier_reviews;

drop function if exists public.rate_supplier(uuid, int, text);

-- ── 2. Restructure supplier_reviews around the order ─────────────────
alter table public.supplier_reviews
  drop constraint if exists supplier_reviews_supplier_id_user_id_key;

alter table public.supplier_reviews
  add column if not exists order_id       uuid references public.supplier_orders(id) on delete cascade,
  add column if not exists vessel_name    text,
  add column if not exists supplier_reply text,
  add column if not exists replied_at     timestamptz,
  add column if not exists reply_by       uuid references auth.users(id);

-- Table is empty (rows cleared above), so NOT NULL + the order key are safe.
alter table public.supplier_reviews
  alter column order_id set not null;

create unique index if not exists supplier_reviews_order_uniq
  on public.supplier_reviews(order_id);
create index if not exists supplier_reviews_supplier_idx
  on public.supplier_reviews(supplier_id);

comment on table public.supplier_reviews is
  'Verified supplier reviews — one per delivered supplier_orders row, editable by the vessel''s crew. Anonymous to other buyers; the fulfilling supplier can trace to the order + vessel and reply.';

-- ── 3. A delivered order is one crew signed for, or that reached the
--        received/invoiced/paid stage. ─────────────────────────────────
create or replace function public.supplier_order_is_delivered(o public.supplier_orders)
returns boolean
language sql immutable
as $$
  select o.crew_signed_at is not null
      or o.status in ('received', 'invoiced', 'paid');
$$;

-- ── 4. Write path: submit / edit a delivered order's review ──────────
create or replace function public.submit_order_review(
  p_order_id uuid, p_rating int, p_note text default null)
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

  -- Caller must be active crew of the vessel that placed the order.
  if not public.is_active_tenant_member(v_order.tenant_id, auth.uid()) then
    raise exception 'not an active crew member of this vessel';
  end if;

  -- Only a delivered order can be reviewed.
  if not public.supplier_order_is_delivered(v_order) then
    raise exception 'you can only review a delivered order';
  end if;

  if v_order.supplier_profile_id is null then
    raise exception 'this order has no marketplace supplier to review';
  end if;

  insert into public.supplier_reviews
      (order_id, supplier_id, tenant_id, vessel_name, user_id, rating, note)
  values
      (p_order_id, v_order.supplier_profile_id, v_order.tenant_id,
       v_order.vessel_name, auth.uid(), p_rating,
       nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (order_id) do update
     set rating     = excluded.rating,
         note       = excluded.note,
         user_id    = excluded.user_id,
         updated_at = now();
end;
$$;

grant execute on function public.submit_order_review(uuid, int, text) to authenticated;

-- ── 5. Crew read: the caller's delivered orders with a supplier, each
--        with its review (if any) — powers "review your deliveries". ──
create or replace function public.get_reviewable_orders(p_supplier_id uuid)
returns table (
  order_id      uuid,
  delivery_date date,
  delivery_port text,
  list_title    text,
  ordered_at    timestamptz,
  rating        int,
  note          text,
  reviewed_at   timestamptz
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
    coalesce(o.crew_signed_at, o.created_at) as ordered_at,
    r.rating,
    r.note,
    r.updated_at
  from public.supplier_orders o
  join public.provisioning_lists pl on pl.id = o.list_id
  left join public.supplier_reviews r on r.order_id = o.id
  where o.supplier_profile_id = p_supplier_id
    and public.is_active_tenant_member(o.tenant_id, auth.uid())
    and public.supplier_order_is_delivered(o)
  order by coalesce(o.crew_signed_at, o.created_at) desc;
$$;

grant execute on function public.get_reviewable_orders(uuid) to authenticated;

-- ── 6. Buyer read: platform-wide average + count (verified only) ─────
drop function if exists public.get_supplier_ratings();
create or replace function public.get_supplier_ratings()
returns table (
  supplier_id  uuid,
  avg_rating   numeric,
  rating_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.supplier_id,
    round(avg(r.rating)::numeric, 1) as avg_rating,
    count(*)::bigint                 as rating_count
  from public.supplier_reviews r
  where exists (
    select 1 from public.tenant_members tm
    where tm.user_id = auth.uid() and tm.active = true
  )
  group by r.supplier_id;
$$;

grant execute on function public.get_supplier_ratings() to authenticated;

-- ── 7. Buyer read: the verified reviews list (anonymous), newest
--        first, with the supplier's public reply. ────────────────────
drop function if exists public.get_supplier_reviews(uuid);
create or replace function public.get_supplier_reviews(p_supplier_id uuid)
returns table (
  id             uuid,
  rating         int,
  note           text,
  created_at     timestamptz,
  supplier_reply text,
  replied_at     timestamptz,
  is_mine        boolean
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
    (r.user_id = auth.uid() or public.is_active_tenant_member(r.tenant_id, auth.uid())) as is_mine
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

-- ── 8. Supplier read: the reviews for MY supplier profile, traceable
--        to their order + vessel (support loop). ──────────────────────
create or replace function public.get_my_supplier_reviews()
returns table (
  id             uuid,
  order_id       uuid,
  vessel_name    text,
  delivery_date  date,
  rating         int,
  note           text,
  created_at     timestamptz,
  supplier_reply text,
  replied_at     timestamptz
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
    r.replied_at
  from public.supplier_reviews r
  join public.supplier_orders o on o.id = r.order_id
  where r.supplier_id = public.get_user_supplier_id()
  order by r.created_at desc;
$$;

grant execute on function public.get_my_supplier_reviews() to authenticated;

-- ── 9. Supplier write: reply to a review on MY supplier profile. ─────
create or replace function public.reply_to_review(p_review_id uuid, p_reply text)
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

  update public.supplier_reviews
     set supplier_reply = nullif(btrim(coalesce(p_reply, '')), ''),
         replied_at     = case when nullif(btrim(coalesce(p_reply, '')), '') is null then null else now() end,
         reply_by       = case when nullif(btrim(coalesce(p_reply, '')), '') is null then null else auth.uid() end
   where id = p_review_id
     and supplier_id = v_supplier;

  if not found then
    raise exception 'review not found for your supplier';
  end if;
end;
$$;

grant execute on function public.reply_to_review(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260717120000_driver_live_location.sql
--
-- Live driver GPS tracking (Phase 2). A driver shares their phone location while
-- delivering; the vessel crew watch it move toward the port on a live map.
--
-- Two driver identities:
--   * internal  — a supplier teammate (supplier_contacts.user_id = auth.uid()).
--                 Posts pings directly (RLS) or via post_driver_ping().
--   * temp      — no account; reaches a capability-URL /drive/:token page and
--                 posts via the SECURITY DEFINER token RPCs (anon-granted),
--                 exactly like the delivery-note signing flow.
-- (External couriers keep their own tracking link — untouched.)
--
-- Pings live in their own table, NOT on supplier_orders, so a 15s cadence never
-- churns the order row (which would spam its activity log + status triggers).
-- ─────────────────────────────────────────────────────────────────────────────

-- Capability token for the no-login driver link (temps, or an internal driver
-- on their phone). Possession of the token is the authorisation.
alter table public.supplier_orders
  add column if not exists driver_share_token text;
create unique index if not exists uq_supplier_orders_driver_share_token
  on public.supplier_orders (driver_share_token)
  where driver_share_token is not null;

create table if not exists public.order_driver_pings (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.supplier_orders(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  accuracy_m  double precision,
  heading     double precision,
  speed       double precision,
  captured_at timestamptz not null default now(),
  source      text not null default 'driver' check (source in ('driver', 'token'))
);
create index if not exists idx_order_driver_pings_order_time
  on public.order_driver_pings (order_id, captured_at desc);

alter table public.order_driver_pings enable row level security;

-- Is auth.uid() the assigned internal driver of this order? SECURITY DEFINER to
-- dodge the supplier RLS recursion documented in 20260419180000.
create or replace function public.is_order_driver(p_order_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.supplier_orders o
    join public.supplier_contacts sc on sc.id = o.driver_contact_id
    where o.id = p_order_id and sc.user_id = auth.uid()
  );
$$;

-- May auth.uid() watch this order's delivery? The vessel's crew, or the
-- supplier's own team.
create or replace function public.can_view_order_delivery(p_order_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.supplier_orders o
    where o.id = p_order_id
      and (
        exists (
          select 1 from public.tenant_members tm
          where tm.tenant_id = o.tenant_id
            and tm.user_id = auth.uid()
            and tm.status <> 'invited'
        )
        or o.supplier_profile_id = public.get_user_supplier_id()
      )
  );
$$;

create policy "driver inserts own pings" on public.order_driver_pings
  for insert to authenticated
  with check (public.is_order_driver(order_id));

create policy "order parties read pings" on public.order_driver_pings
  for select to authenticated
  using (public.can_view_order_delivery(order_id));

-- Live map subscribes to inserts here (matches the app's realtime pattern).
alter publication supabase_realtime add table public.order_driver_pings;

-- ── Token (no-login) driver page ────────────────────────────────────────────
-- Minimal order info for the /drive/:token page. Never returns the token.
create or replace function public.fetch_order_for_driver_token(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if p_token is null or length(p_token) < 16 then return null; end if;
  select jsonb_build_object(
    'id',            o.id,
    'supplier_name', o.supplier_name,
    'driver_name',   o.driver_name,
    'driver_status', o.driver_status,
    'delivery_port', o.delivery_port,
    'delivery_date', o.delivery_date,
    'delivery_eta',  o.delivery_eta,
    'status',        o.status
  ) into v
  from public.supplier_orders o
  where o.driver_share_token = p_token;
  return v;  -- null on miss; never leaks the token or the order's existence
end;
$$;
grant execute on function public.fetch_order_for_driver_token(text) to anon, authenticated;

-- Post a ping (and optionally advance status) from the token page.
create or replace function public.post_driver_ping_token(
  p_token    text,
  p_lat      double precision default null,
  p_lng      double precision default null,
  p_accuracy double precision default null,
  p_heading  double precision default null,
  p_speed    double precision default null,
  p_status   text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_order uuid;
begin
  if p_token is null or length(p_token) < 16 then return; end if;
  select id into v_order from public.supplier_orders where driver_share_token = p_token;
  if v_order is null then return; end if;

  -- A location ping (only when coords are present — status can be tapped before
  -- the driver enables sharing).
  if p_lat is not null and p_lng is not null then
    insert into public.order_driver_pings (order_id, lat, lng, accuracy_m, heading, speed, source)
    values (v_order, p_lat, p_lng, p_accuracy, p_heading, p_speed, 'token');
  end if;

  if p_status in ('on_the_way', 'arrived', 'delivered') then
    update public.supplier_orders
      set driver_status = p_status,
          status = case
            when p_status = 'delivered'               then 'received'
            when p_status in ('on_the_way','arrived') then 'out_for_delivery'
            else status end,
          delivered_at = case
            when p_status = 'delivered'               then now()
            when p_status in ('on_the_way','arrived') then null
            else delivered_at end
      where id = v_order;
  end if;
end;
$$;
grant execute on function public.post_driver_ping_token(text, double precision, double precision, double precision, double precision, double precision, text) to anon, authenticated;

-- ── Authed internal driver ──────────────────────────────────────────────────
create or replace function public.post_driver_ping(
  p_order_id uuid,
  p_lat      double precision,
  p_lng      double precision,
  p_accuracy double precision default null,
  p_heading  double precision default null,
  p_speed    double precision default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_order_driver(p_order_id) then return; end if;
  insert into public.order_driver_pings (order_id, lat, lng, accuracy_m, heading, speed, source)
  values (p_order_id, p_lat, p_lng, p_accuracy, p_heading, p_speed, 'driver');
end;
$$;
grant execute on function public.post_driver_ping(uuid, double precision, double precision, double precision, double precision, double precision) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260717130000_driver_live_location_heal.sql
--
-- Creates the Phase 2 driver-tracking objects (idempotently).
--
-- The original 20260717120000_driver_live_location.sql was given a version that
-- was ALREADY taken by 20260717120000_defect_location_snapshot.sql.
-- schema_migrations.version is a primary key, so the driver migration's whole
-- transaction rolled back every run ("version 20260717120000 already exists")
-- and its objects were never created — which also blocked every migration
-- queued behind it. That duplicate file has been deleted; this migration (a
-- unique version) is now the real creator. Every statement is safe whether or
-- not the object already exists, so it's correct regardless of prior partial
-- state.
-- ─────────────────────────────────────────────────────────────────────────────

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

create or replace function public.is_order_driver(p_order_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.supplier_orders o
    join public.supplier_contacts sc on sc.id = o.driver_contact_id
    where o.id = p_order_id and sc.user_id = auth.uid()
  );
$$;

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

drop policy if exists "driver inserts own pings" on public.order_driver_pings;
create policy "driver inserts own pings" on public.order_driver_pings
  for insert to authenticated
  with check (public.is_order_driver(order_id));

drop policy if exists "order parties read pings" on public.order_driver_pings;
create policy "order parties read pings" on public.order_driver_pings
  for select to authenticated
  using (public.can_view_order_delivery(order_id));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'order_driver_pings'
  ) then
    alter publication supabase_realtime add table public.order_driver_pings;
  end if;
end $$;

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
  return v;
end;
$$;
grant execute on function public.fetch_order_for_driver_token(text) to anon, authenticated;

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

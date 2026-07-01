-- ─────────────────────────────────────────────────────────────────────────────
-- 20260701120000_crew_cabins_and_assignments.sql
--
-- WHAT: Cabin setup + crew↔bed allocation behind the new Crew Movements board.
--
--   vessel_cabins      one row per cabin on a vessel (name/number, deck, linen
--                      day). Laundry number/colour is NOT here — that's per-crew
--                      in Issued Kit.
--   cabin_beds         the beds within a cabin ("Bed A", "Upper"/"Lower", …). A
--                      cabin sleeps as many crew as it has beds.
--   cabin_assignments  a crew member berthed in a bed for a date range. One
--                      person can have several consecutive assignments as they
--                      move cabins over a tour; end_date is the first FREE day
--                      (the departure/move date), null = open-ended.
--
-- RLS: any active tenant member reads; COMMAND / CHIEF / HOD (command + the
--      purser/chief-stew heads who actually set cabins) write. Tenant scoping is
--      denormalised onto every table so policies stay simple/fast.
--
-- IDEMPOTENCY: create table/policy IF NOT EXISTS + drop-then-create policies.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.vessel_cabins (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  name        text not null,          -- "Cabin 2", "VIP", "3" — free text
  deck        text,                   -- "Lower deck · fwd", etc.
  linen_day   text,                   -- Mon..Sun (weekly strip & remake), or null
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid
);
create index if not exists vessel_cabins_tenant_idx on public.vessel_cabins (tenant_id);

create table if not exists public.cabin_beds (
  id          uuid primary key default gen_random_uuid(),
  cabin_id    uuid not null references public.vessel_cabins(id) on delete cascade,
  tenant_id   uuid not null,
  label       text not null,          -- "Bed A", "Upper", "Single" — free text
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists cabin_beds_cabin_idx  on public.cabin_beds (cabin_id);
create index if not exists cabin_beds_tenant_idx on public.cabin_beds (tenant_id);

create table if not exists public.cabin_assignments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  bed_id      uuid not null references public.cabin_beds(id) on delete cascade,
  user_id     uuid not null,          -- crew member berthed here
  start_date  date not null,          -- first night in the bed
  end_date    date,                   -- first FREE day (departure/move); null = open-ended
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid
);
create index if not exists cabin_assignments_tenant_idx on public.cabin_assignments (tenant_id);
create index if not exists cabin_assignments_bed_idx    on public.cabin_assignments (bed_id);
create index if not exists cabin_assignments_user_idx   on public.cabin_assignments (user_id);

alter table public.vessel_cabins     enable row level security;
alter table public.cabin_beds        enable row level security;
alter table public.cabin_assignments enable row level security;

grant select, insert, update, delete on public.vessel_cabins     to authenticated;
grant select, insert, update, delete on public.cabin_beds        to authenticated;
grant select, insert, update, delete on public.cabin_assignments to authenticated;

-- ── vessel_cabins ────────────────────────────────────────────────────────────
drop policy if exists vessel_cabins_read on public.vessel_cabins;
create policy vessel_cabins_read on public.vessel_cabins for select using (
  exists (select 1 from public.tenant_members tm
          where tm.user_id = auth.uid() and tm.tenant_id = vessel_cabins.tenant_id and tm.active = true));
drop policy if exists vessel_cabins_write on public.vessel_cabins;
create policy vessel_cabins_write on public.vessel_cabins for all
  using (exists (select 1 from public.tenant_members tm
                 where tm.user_id = auth.uid() and tm.tenant_id = vessel_cabins.tenant_id
                   and tm.active = true and tm.permission_tier in ('COMMAND','CHIEF','HOD')))
  with check (exists (select 1 from public.tenant_members tm
                 where tm.user_id = auth.uid() and tm.tenant_id = vessel_cabins.tenant_id
                   and tm.active = true and tm.permission_tier in ('COMMAND','CHIEF','HOD')));

-- ── cabin_beds ───────────────────────────────────────────────────────────────
drop policy if exists cabin_beds_read on public.cabin_beds;
create policy cabin_beds_read on public.cabin_beds for select using (
  exists (select 1 from public.tenant_members tm
          where tm.user_id = auth.uid() and tm.tenant_id = cabin_beds.tenant_id and tm.active = true));
drop policy if exists cabin_beds_write on public.cabin_beds;
create policy cabin_beds_write on public.cabin_beds for all
  using (exists (select 1 from public.tenant_members tm
                 where tm.user_id = auth.uid() and tm.tenant_id = cabin_beds.tenant_id
                   and tm.active = true and tm.permission_tier in ('COMMAND','CHIEF','HOD')))
  with check (exists (select 1 from public.tenant_members tm
                 where tm.user_id = auth.uid() and tm.tenant_id = cabin_beds.tenant_id
                   and tm.active = true and tm.permission_tier in ('COMMAND','CHIEF','HOD')));

-- ── cabin_assignments ────────────────────────────────────────────────────────
drop policy if exists cabin_assignments_read on public.cabin_assignments;
create policy cabin_assignments_read on public.cabin_assignments for select using (
  exists (select 1 from public.tenant_members tm
          where tm.user_id = auth.uid() and tm.tenant_id = cabin_assignments.tenant_id and tm.active = true));
drop policy if exists cabin_assignments_write on public.cabin_assignments;
create policy cabin_assignments_write on public.cabin_assignments for all
  using (exists (select 1 from public.tenant_members tm
                 where tm.user_id = auth.uid() and tm.tenant_id = cabin_assignments.tenant_id
                   and tm.active = true and tm.permission_tier in ('COMMAND','CHIEF','HOD')))
  with check (exists (select 1 from public.tenant_members tm
                 where tm.user_id = auth.uid() and tm.tenant_id = cabin_assignments.tenant_id
                   and tm.active = true and tm.permission_tier in ('COMMAND','CHIEF','HOD')));

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260701130000_crew_travel_legs.sql
--
-- WHAT: onward legs for a crew travel entry, so one journey can be multi-hop —
--       e.g. a flight LHR→NCE, THEN a taxi NCE→marina — instead of two separate
--       entries. The parent crew_calendar_entries row remains "leg 1" (its own
--       transport/route/times); crew_travel_legs holds leg 2 onward. Deleting the
--       journey cascades its legs.
--
-- RLS: tenant members read; COMMAND/CHIEF/HOD write (matches the movements board).
--
-- IDEMPOTENCY: create table/policy IF NOT EXISTS + drop-then-create policies.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.crew_travel_legs (
  id            uuid primary key default gen_random_uuid(),
  entry_id      uuid not null references public.crew_calendar_entries(id) on delete cascade,
  tenant_id     uuid,
  seq           integer not null default 2,
  leg_date      date,
  transport     text,
  transport_no  text,
  from_location text,
  to_location   text,
  depart_time   text,
  arrive_time   text,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists crew_travel_legs_entry_idx  on public.crew_travel_legs (entry_id);
create index if not exists crew_travel_legs_tenant_idx on public.crew_travel_legs (tenant_id);

alter table public.crew_travel_legs enable row level security;
grant select, insert, update, delete on public.crew_travel_legs to authenticated;

drop policy if exists crew_travel_legs_read on public.crew_travel_legs;
create policy crew_travel_legs_read on public.crew_travel_legs for select using (
  exists (select 1 from public.tenant_members tm
          where tm.user_id = auth.uid() and tm.tenant_id = crew_travel_legs.tenant_id and tm.active = true));
drop policy if exists crew_travel_legs_write on public.crew_travel_legs;
create policy crew_travel_legs_write on public.crew_travel_legs for all
  using (exists (select 1 from public.tenant_members tm
                 where tm.user_id = auth.uid() and tm.tenant_id = crew_travel_legs.tenant_id
                   and tm.active = true and tm.permission_tier in ('COMMAND','CHIEF','HOD')))
  with check (exists (select 1 from public.tenant_members tm
                 where tm.user_id = auth.uid() and tm.tenant_id = crew_travel_legs.tenant_id
                   and tm.active = true and tm.permission_tier in ('COMMAND','CHIEF','HOD')));

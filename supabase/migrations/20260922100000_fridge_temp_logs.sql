-- Weekly fridge/freezer temperature logging (food-safety / HACCP).
-- `fridges` is a short per-vessel list of appliances, each with a safe range;
-- `fridge_temp_logs` records each reading (typed temp and/or a photo), flagged
-- in/out of range.
create table if not exists public.fridges (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  name       text not null,
  kind       text not null default 'fridge' check (kind in ('fridge','freezer')),
  location   text,
  code       text,                         -- short code encoded in the printable QR label
  safe_min   numeric,
  safe_max   numeric,
  sort_order int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fridge_temp_logs (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  fridge_id  uuid not null references public.fridges(id) on delete cascade,
  temp_c     numeric,
  photo_url  text,
  in_range   boolean,
  note       text,
  logged_by  uuid,
  logged_at  timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists fridge_temp_logs_tenant_fridge_idx
  on public.fridge_temp_logs (tenant_id, fridge_id, logged_at desc);

alter table public.fridges enable row level security;
alter table public.fridge_temp_logs enable row level security;

-- Fridges: everyone active reads; COMMAND/CHIEF manage the list + ranges.
drop policy if exists fridges_select on public.fridges;
create policy fridges_select on public.fridges for select to authenticated
  using (exists (select 1 from tenant_members tm
                 where tm.user_id = auth.uid() and tm.tenant_id = fridges.tenant_id and tm.active is not false));

drop policy if exists fridges_insert on public.fridges;
create policy fridges_insert on public.fridges for insert to authenticated
  with check (exists (select 1 from tenant_members tm
                      where tm.user_id = auth.uid() and tm.tenant_id = fridges.tenant_id and tm.active is not false
                        and tm.permission_tier = any (array['COMMAND'::text,'CHIEF'::text])));

drop policy if exists fridges_update on public.fridges;
create policy fridges_update on public.fridges for update to authenticated
  using (exists (select 1 from tenant_members tm
                 where tm.user_id = auth.uid() and tm.tenant_id = fridges.tenant_id and tm.active is not false
                   and tm.permission_tier = any (array['COMMAND'::text,'CHIEF'::text])))
  with check (exists (select 1 from tenant_members tm
                      where tm.user_id = auth.uid() and tm.tenant_id = fridges.tenant_id and tm.active is not false
                        and tm.permission_tier = any (array['COMMAND'::text,'CHIEF'::text])));

drop policy if exists fridges_delete on public.fridges;
create policy fridges_delete on public.fridges for delete to authenticated
  using (exists (select 1 from tenant_members tm
                 where tm.user_id = auth.uid() and tm.tenant_id = fridges.tenant_id and tm.active is not false
                   and tm.permission_tier = any (array['COMMAND'::text,'CHIEF'::text])));

-- Logs: any active member reads and inserts (crew log the checks). Edits/deletes
-- kept to COMMAND/CHIEF so the record isn't casually rewritten.
drop policy if exists fridge_temp_logs_select on public.fridge_temp_logs;
create policy fridge_temp_logs_select on public.fridge_temp_logs for select to authenticated
  using (exists (select 1 from tenant_members tm
                 where tm.user_id = auth.uid() and tm.tenant_id = fridge_temp_logs.tenant_id and tm.active is not false));

drop policy if exists fridge_temp_logs_insert on public.fridge_temp_logs;
create policy fridge_temp_logs_insert on public.fridge_temp_logs for insert to authenticated
  with check (exists (select 1 from tenant_members tm
                      where tm.user_id = auth.uid() and tm.tenant_id = fridge_temp_logs.tenant_id and tm.active is not false));

drop policy if exists fridge_temp_logs_update on public.fridge_temp_logs;
create policy fridge_temp_logs_update on public.fridge_temp_logs for update to authenticated
  using (exists (select 1 from tenant_members tm
                 where tm.user_id = auth.uid() and tm.tenant_id = fridge_temp_logs.tenant_id and tm.active is not false
                   and tm.permission_tier = any (array['COMMAND'::text,'CHIEF'::text])))
  with check (exists (select 1 from tenant_members tm
                      where tm.user_id = auth.uid() and tm.tenant_id = fridge_temp_logs.tenant_id and tm.active is not false
                        and tm.permission_tier = any (array['COMMAND'::text,'CHIEF'::text])));

drop policy if exists fridge_temp_logs_delete on public.fridge_temp_logs;
create policy fridge_temp_logs_delete on public.fridge_temp_logs for delete to authenticated
  using (exists (select 1 from tenant_members tm
                 where tm.user_id = auth.uid() and tm.tenant_id = fridge_temp_logs.tenant_id and tm.active is not false
                   and tm.permission_tier = any (array['COMMAND'::text,'CHIEF'::text])));

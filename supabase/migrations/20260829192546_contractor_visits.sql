-- Contractors / visitors signed in at the gangway — the third leg of persons-on-
-- board (alongside crew_presence and on-trip guests). Lightweight: name, optional
-- company, and an onboard/ashore status with sign-in/out times.
create table if not exists public.contractor_visits (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  name          text not null,
  company       text,
  status        text not null default 'onboard' check (status in ('onboard','ashore')),
  signed_in_at  timestamptz not null default now(),
  signed_out_at timestamptz,
  note          text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.contractor_visits enable row level security;

-- Any active member of the tenant can see and manage the gangway contractor list
-- (the shared board device, or crew signing a contractor in/out).
drop policy if exists contractor_visits_select on public.contractor_visits;
create policy contractor_visits_select on public.contractor_visits
  for select to authenticated
  using (exists (select 1 from tenant_members tm
                 where tm.user_id = auth.uid() and tm.tenant_id = contractor_visits.tenant_id and tm.active is not false));

drop policy if exists contractor_visits_insert on public.contractor_visits;
create policy contractor_visits_insert on public.contractor_visits
  for insert to authenticated
  with check (exists (select 1 from tenant_members tm
                      where tm.user_id = auth.uid() and tm.tenant_id = contractor_visits.tenant_id and tm.active is not false));

drop policy if exists contractor_visits_update on public.contractor_visits;
create policy contractor_visits_update on public.contractor_visits
  for update to authenticated
  using (exists (select 1 from tenant_members tm
                 where tm.user_id = auth.uid() and tm.tenant_id = contractor_visits.tenant_id and tm.active is not false))
  with check (exists (select 1 from tenant_members tm
                      where tm.user_id = auth.uid() and tm.tenant_id = contractor_visits.tenant_id and tm.active is not false));

drop policy if exists contractor_visits_delete on public.contractor_visits;
create policy contractor_visits_delete on public.contractor_visits
  for delete to authenticated
  using (exists (select 1 from tenant_members tm
                 where tm.user_id = auth.uid() and tm.tenant_id = contractor_visits.tenant_id and tm.active is not false));

create index if not exists contractor_visits_tenant_status_idx
  on public.contractor_visits (tenant_id, status);

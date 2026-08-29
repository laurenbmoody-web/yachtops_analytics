-- Lightweight daily aboard/ashore presence — who is physically on the boat right
-- now. Deliberately separate from the crew leave/rotation status system so a quick
-- shore run never touches someone's rotation record. One row per (tenant, crew).
create table if not exists public.crew_presence (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  user_id    uuid not null,
  status     text not null default 'aboard' check (status in ('aboard','ashore')),
  note       text,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

alter table public.crew_presence enable row level security;

-- Read: any active member of the tenant can see the board.
drop policy if exists crew_presence_select on public.crew_presence;
create policy crew_presence_select on public.crew_presence
  for select to authenticated
  using (
    exists (select 1 from tenant_members tm
            where tm.user_id = auth.uid()
              and tm.tenant_id = crew_presence.tenant_id
              and tm.active is not false)
  );

-- Write: your own row always; COMMAND/CHIEF (the shared board device) may toggle
-- anyone in the tenant.
drop policy if exists crew_presence_insert on public.crew_presence;
create policy crew_presence_insert on public.crew_presence
  for insert to authenticated
  with check (
    exists (select 1 from tenant_members tm
            where tm.user_id = auth.uid()
              and tm.tenant_id = crew_presence.tenant_id
              and tm.active is not false
              and (tm.user_id = crew_presence.user_id
                   or tm.permission_tier = any (array['COMMAND'::text,'CHIEF'::text])))
  );

drop policy if exists crew_presence_update on public.crew_presence;
create policy crew_presence_update on public.crew_presence
  for update to authenticated
  using (
    exists (select 1 from tenant_members tm
            where tm.user_id = auth.uid()
              and tm.tenant_id = crew_presence.tenant_id
              and tm.active is not false
              and (tm.user_id = crew_presence.user_id
                   or tm.permission_tier = any (array['COMMAND'::text,'CHIEF'::text])))
  )
  with check (
    exists (select 1 from tenant_members tm
            where tm.user_id = auth.uid()
              and tm.tenant_id = crew_presence.tenant_id
              and tm.active is not false
              and (tm.user_id = crew_presence.user_id
                   or tm.permission_tier = any (array['COMMAND'::text,'CHIEF'::text])))
  );

-- Gangway history: an append-only log of every sign in/out (crew, guests,
-- visitors) from any device, plus saved muster roll calls.

-- Every aboard/ashore change, logged from both personal devices and the
-- entry-door iPad. Never overwritten — crew_presence keeps the current status,
-- this keeps the trail.
create table if not exists public.presence_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  subject_type text not null default 'crew',   -- crew | guest | visitor
  subject_id text,
  subject_name text,
  direction text not null,                      -- aboard | ashore
  actor_user_id uuid,
  actor_name text,
  source text not null default 'app',           -- personal | entryway | app
  created_at timestamptz not null default now()
);
create index if not exists presence_events_tenant_time
  on public.presence_events (tenant_id, created_at desc);

alter table public.presence_events enable row level security;
create policy presence_events_select on public.presence_events
  for select to authenticated
  using (tenant_id in (select tenant_id from tenant_members where user_id = auth.uid() and active = true));
create policy presence_events_insert on public.presence_events
  for insert to authenticated
  with check (tenant_id in (select tenant_id from tenant_members where user_id = auth.uid() and active = true));

-- A saved muster: the roll calls taken and who was marked on each, as a
-- self-contained snapshot so the record stands even if crew later change.
create table if not exists public.muster_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text,
  expected int,
  roll_calls jsonb not null default '[]'::jsonb,  -- [{ name, count, marked:[key..] }]
  roster jsonb not null default '[]'::jsonb        -- [{ key, name, sub, aboard }]
);
create index if not exists muster_records_tenant_time
  on public.muster_records (tenant_id, created_at desc);

alter table public.muster_records enable row level security;
create policy muster_records_select on public.muster_records
  for select to authenticated
  using (tenant_id in (select tenant_id from tenant_members where user_id = auth.uid() and active = true));
create policy muster_records_insert on public.muster_records
  for insert to authenticated
  with check (tenant_id in (select tenant_id from tenant_members where user_id = auth.uid() and active = true));

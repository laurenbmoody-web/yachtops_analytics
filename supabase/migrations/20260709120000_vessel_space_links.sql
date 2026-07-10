-- 20260709120000_vessel_space_links.sql
--
-- Full-vessel layout, phase 4: doorway links between rooms. A link is an
-- undirected connection between two spaces (vessel_locations rows at level
-- 'space') — "you can walk from A to B". Authored on the deck plan; later
-- surfaced in the 3D vessel map as room-to-room walkthrough navigation.
--
-- The pair is stored canonically (a_space_id < b_space_id) so each doorway is
-- one row regardless of which end it was drawn from, and a unique constraint
-- keeps it that way.

create table if not exists public.vessel_space_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  a_space_id uuid not null references public.vessel_locations(id) on delete cascade,
  b_space_id uuid not null references public.vessel_locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint vessel_space_links_ordered check (a_space_id < b_space_id),
  constraint vessel_space_links_uniq unique (a_space_id, b_space_id)
);

create index if not exists vessel_space_links_tenant_idx on public.vessel_space_links (tenant_id);

alter table public.vessel_space_links enable row level security;

-- Any active member of the vessel may read the links.
create policy vessel_space_links_member_read on public.vessel_space_links
  for select to authenticated
  using (exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = vessel_space_links.tenant_id
       and tm.user_id = auth.uid()
       and tm.active = true));

-- Command / Chief may create + delete them.
create policy vessel_space_links_command_write on public.vessel_space_links
  for all to authenticated
  using (exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = vessel_space_links.tenant_id
       and tm.user_id = auth.uid()
       and tm.active = true
       and tm.permission_tier = any (array['COMMAND','CHIEF'])))
  with check (exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = vessel_space_links.tenant_id
       and tm.user_id = auth.uid()
       and tm.active = true
       and tm.permission_tier = any (array['COMMAND','CHIEF'])));

comment on table public.vessel_space_links is
  'Undirected doorway links between two rooms (vessel_locations level=space). Authored on the deck plan; drives room-to-room walkthrough navigation. Pair stored canonically a_space_id < b_space_id.';

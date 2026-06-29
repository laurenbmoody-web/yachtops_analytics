-- Foundation for vessel position → country attribution (the AIS landing zone).
--
-- One row per vessel per day with the resolved coastal/flag state and maritime
-- zone. Both an AIS feed and a manual voyage/port log write here (source), so
-- the residency engine reads a single shape regardless of how the position was
-- obtained. Country resolution (lat/lon → country, incl. Schengen 12nm/EEZ
-- nuance) is done by whoever writes the row (the AIS adapter or a person), not
-- here.
--
-- Only aboard days matter for residency, so the engine joins these positions to
-- the days crew_status_history says the member was 'active'.
create table if not exists vessel_positions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  vessel_id     uuid,
  observed_on   date not null,
  observed_at   timestamptz,
  latitude      double precision,
  longitude     double precision,
  country_code  text,                 -- ISO-2 coastal/flag state for the day
  maritime_zone text,                 -- e.g. 'territorial' | 'eez' | 'high_seas' | 'in_port'
  schengen      boolean,              -- true if the day counts as Schengen presence
  source        text not null default 'manual',  -- 'ais' | 'manual' | 'voyage'
  note          text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One authoritative row per vessel/day/source (AIS can refine a manual guess).
create unique index if not exists vessel_positions_uniq
  on vessel_positions (tenant_id, coalesce(vessel_id, '00000000-0000-0000-0000-000000000000'::uuid), observed_on, source);
create index if not exists vessel_positions_lookup
  on vessel_positions (tenant_id, observed_on);

alter table vessel_positions enable row level security;

-- Any active member of the vessel can read positions.
-- (drop-if-exists makes a re-run idempotent — the CI db push retries
--  and a bare CREATE POLICY errors 42710 if the policy already exists.)
drop policy if exists vessel_positions_tenant_read on vessel_positions;
create policy vessel_positions_tenant_read on vessel_positions
  for select using (
    tenant_id in (
      select tenant_id from tenant_members
      where user_id = auth.uid() and active = true
    )
  );

-- COMMAND / CHIEF manage positions (and the AIS adapter runs as service role).
drop policy if exists vessel_positions_command_write on vessel_positions;
create policy vessel_positions_command_write on vessel_positions
  for all using (
    exists (
      select 1 from tenant_members tm
      where tm.tenant_id = vessel_positions.tenant_id
        and tm.user_id = auth.uid() and tm.active = true
        and tm.permission_tier = any (array['COMMAND','CHIEF'])
    )
  ) with check (
    exists (
      select 1 from tenant_members tm
      where tm.tenant_id = vessel_positions.tenant_id
        and tm.user_id = auth.uid() and tm.active = true
        and tm.permission_tier = any (array['COMMAND','CHIEF'])
    )
  );

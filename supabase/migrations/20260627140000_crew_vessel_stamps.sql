-- Vessel sign-on / sign-off "stamps" — the immigration events that pause a crew
-- member's Schengen/visa clock.
--
-- When a crew member is stamped ONTO the vessel's crew list they're stamped out
-- of the country, so their 90/180 (and visa allowance) clock pauses for as long
-- as they're signed on — wherever the vessel sails. Stamped OFF resumes it. The
-- stamp is the source of truth (not physical presence aboard, and independent of
-- whether the vessel is commercial or private): if they're stamped on, it pauses.
--
-- Each row is one stamp event; a crew member is "signed on" from an 'on' stamp
-- until the next 'off' stamp.
create table if not exists crew_vessel_stamps (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  tenant_id   uuid,
  kind        text not null check (kind in ('on', 'off')),
  stamp_date  date not null,
  place       text,          -- where stamped, e.g. "Antibes, France"
  country     text,          -- ISO-2 of that place (where they re-enter on sign-off)
  note        text,
  actor_id    uuid,
  actor_name  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists crew_vessel_stamps_lookup on crew_vessel_stamps (user_id, stamp_date);

alter table crew_vessel_stamps enable row level security;

-- The crew member sees their own stamps; COMMAND/CHIEF in the tenant manage them.
-- (drop-if-exists keeps the migration idempotent across db-push retries.)
drop policy if exists crew_vessel_stamps_select on crew_vessel_stamps;
create policy crew_vessel_stamps_select on crew_vessel_stamps
  for select using (
    user_id = auth.uid()
    or tenant_id in (
      select tenant_id from tenant_members
      where user_id = auth.uid() and active = true
        and permission_tier = any (array['COMMAND', 'CHIEF'])
    )
  );
drop policy if exists crew_vessel_stamps_write on crew_vessel_stamps;
create policy crew_vessel_stamps_write on crew_vessel_stamps
  for all using (
    tenant_id in (
      select tenant_id from tenant_members
      where user_id = auth.uid() and active = true
        and permission_tier = any (array['COMMAND', 'CHIEF'])
    )
  ) with check (
    tenant_id in (
      select tenant_id from tenant_members
      where user_id = auth.uid() and active = true
        and permission_tier = any (array['COMMAND', 'CHIEF'])
    )
  );

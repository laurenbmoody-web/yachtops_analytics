-- Crew profile statement — the crew member's own guest-facing bio, plus a few
-- light fields that enrich the guest-book profile sheet. Written by the crew
-- member (optionally AI-assisted); read by everyone aboard so a Chief/Purser can
-- compile the guest-book crew sheets.
create table if not exists crew_profile_statements (
  user_id     uuid primary key,
  tenant_id   uuid,
  statement   text,            -- the bio / profile statement
  headline    text,            -- short tagline, e.g. "Adventurous chief stew, keen freediver"
  hometown    text,
  languages   text,
  interests   text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

alter table crew_profile_statements enable row level security;

-- Anyone active in the tenant can read (needed to assemble the guest sheets).
drop policy if exists crew_profile_statements_select on crew_profile_statements;
create policy crew_profile_statements_select on crew_profile_statements
  for select using (
    user_id = auth.uid()
    or tenant_id in (select tenant_id from tenant_members where user_id = auth.uid() and active = true)
  );

-- The crew member writes their own; COMMAND/CHIEF can edit anyone's.
drop policy if exists crew_profile_statements_write on crew_profile_statements;
create policy crew_profile_statements_write on crew_profile_statements
  for all using (
    user_id = auth.uid()
    or tenant_id in (
      select tenant_id from tenant_members
      where user_id = auth.uid() and active = true and permission_tier = any (array['COMMAND', 'CHIEF'])
    )
  ) with check (
    user_id = auth.uid()
    or tenant_id in (
      select tenant_id from tenant_members
      where user_id = auth.uid() and active = true and permission_tier = any (array['COMMAND', 'CHIEF'])
    )
  );

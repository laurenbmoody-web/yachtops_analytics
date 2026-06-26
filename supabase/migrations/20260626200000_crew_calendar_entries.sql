-- ─────────────────────────────────────────────────────────────────────────────
-- 20260626200000_crew_calendar_entries.sql
--
-- WHAT: Scheduled leave / travel entries for a crew member, shown on the profile
--       Activity month calendar (colouring the days) and logged in the activity
--       feed. Each entry is a dated range with optional travel detail (route +
--       transport / flight no + times) and a note.
--
--       Managed by COMMAND (managers schedule crew leave/travel); the crew member
--       sees their own entries read-only.
--
-- IDEMPOTENCY: CREATE TABLE/POLICY IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.crew_calendar_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  tenant_id     uuid,
  kind          text not null default 'leave',  -- leave | travel | joining | disembarking | other
  start_date    date not null,
  end_date      date not null,
  from_location text,
  to_location   text,
  transport     text,                            -- Flight | Train | Ferry | Car | …
  transport_no  text,                            -- flight / train no
  depart_time   text,
  arrive_time   text,
  note          text,
  actor_id      uuid,
  actor_name    text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists crew_calendar_entries_user_idx on public.crew_calendar_entries (user_id, start_date);

alter table public.crew_calendar_entries enable row level security;

grant select, insert, update, delete on public.crew_calendar_entries to authenticated;

-- The crew member sees their own entries (read-only).
drop policy if exists crew_calendar_owner_select on public.crew_calendar_entries;
create policy crew_calendar_owner_select
  on public.crew_calendar_entries for select
  using (user_id = auth.uid());

-- COMMAND in a shared active tenant fully manages a crew member's entries.
drop policy if exists crew_calendar_command_all on public.crew_calendar_entries;
create policy crew_calendar_command_all
  on public.crew_calendar_entries for all
  using (
    exists (
      select 1 from public.tenant_members viewer
      join public.tenant_members subject on subject.tenant_id = viewer.tenant_id
      where viewer.user_id = auth.uid() and viewer.active = true
        and viewer.permission_tier = 'COMMAND'
        and subject.user_id = crew_calendar_entries.user_id
    )
  )
  with check (
    exists (
      select 1 from public.tenant_members viewer
      join public.tenant_members subject on subject.tenant_id = viewer.tenant_id
      where viewer.user_id = auth.uid() and viewer.active = true
        and viewer.permission_tier = 'COMMAND'
        and subject.user_id = crew_calendar_entries.user_id
    )
  );

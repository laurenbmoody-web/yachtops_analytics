-- ─────────────────────────────────────────────────────────────────────────────
-- 20260626180000_crew_profile_events.sql
--
-- WHAT: Field-level audit of crew profile edits — Personal Details and Banking.
--       Each changed field writes a row (label + old/new value where not
--       sensitive) so the profile Activity log can show "Nationality: British →
--       French" with who and when, rather than a coarse "profile updated".
--
--       Written by saveCrewProfileData() after a successful save. Read by the
--       owner and by COMMAND in a shared tenant. Append-only.
--
-- IDEMPOTENCY: CREATE TABLE/POLICY IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.crew_profile_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,             -- profile the change belongs to
  tenant_id   uuid,
  area        text not null,             -- personal | banking
  field       text,
  label       text not null,
  old_value   text,                      -- null for sensitive (banking) / json fields
  new_value   text,
  actor_id    uuid,
  actor_name  text,
  created_at  timestamptz not null default now()
);

create index if not exists crew_profile_events_user_idx on public.crew_profile_events (user_id, created_at desc);

alter table public.crew_profile_events enable row level security;

grant select, insert on public.crew_profile_events to authenticated;

drop policy if exists crew_profile_events_select on public.crew_profile_events;
create policy crew_profile_events_select
  on public.crew_profile_events for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.tenant_members viewer
      join public.tenant_members subject on subject.tenant_id = viewer.tenant_id
      where viewer.user_id = auth.uid() and viewer.active = true
        and viewer.permission_tier = 'COMMAND'
        and subject.user_id = crew_profile_events.user_id
    )
  );

drop policy if exists crew_profile_events_insert on public.crew_profile_events;
create policy crew_profile_events_insert
  on public.crew_profile_events for insert
  with check (
    actor_id = auth.uid()
    and (
      user_id = auth.uid()
      or exists (
        select 1 from public.tenant_members viewer
        join public.tenant_members subject on subject.tenant_id = viewer.tenant_id
        where viewer.user_id = auth.uid() and viewer.active = true
          and viewer.permission_tier = 'COMMAND'
          and subject.user_id = crew_profile_events.user_id
      )
    )
  );

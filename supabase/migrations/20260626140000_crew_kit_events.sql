-- ─────────────────────────────────────────────────────────────────────────────
-- 20260626140000_crew_kit_events.sql
--
-- WHAT: Append-only history/audit log for a crew member's issued kit — every
--       issue, edit, acknowledgement, return, loss, reinstatement, removal and
--       size change is recorded so the kit register has a full paper-trail.
--
--       Events are written by whoever performs the action: the crew member when
--       they acknowledge receipt (auth.uid() = user_id), or COMMAND when issuing
--       / returning on their behalf. The log is read-only after the fact.
--
-- IDEMPOTENCY: CREATE TABLE/POLICY IF NOT EXISTS. Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.crew_kit_events (
  id          uuid primary key default gen_random_uuid(),
  kit_id      uuid,                 -- the item (null for batch / size-only events)
  user_id     uuid not null,        -- crew member the kit belongs to
  tenant_id   uuid,
  action      text not null,        -- issued | edited | acknowledged | returned | lost | reinstated | removed | size_changed
  detail      jsonb not null default '{}'::jsonb,
  actor_id    uuid,
  actor_name  text,
  created_at  timestamptz not null default now()
);

create index if not exists crew_kit_events_user_idx on public.crew_kit_events (user_id, created_at desc);
create index if not exists crew_kit_events_kit_idx  on public.crew_kit_events (kit_id);

alter table public.crew_kit_events enable row level security;

grant select, insert on public.crew_kit_events to authenticated;

-- Read: the crew member sees their own history; COMMAND sees their tenant's crew.
drop policy if exists crew_kit_events_select on public.crew_kit_events;
create policy crew_kit_events_select
  on public.crew_kit_events for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.tenant_members viewer
      join public.tenant_members subject on subject.tenant_id = viewer.tenant_id
      where viewer.user_id = auth.uid() and viewer.active = true
        and viewer.permission_tier = 'COMMAND'
        and subject.user_id = crew_kit_events.user_id
    )
  );

-- Insert: the crew member can log their own actions (acknowledgement); COMMAND
-- can log actions for a crew member in their tenant.
drop policy if exists crew_kit_events_insert on public.crew_kit_events;
create policy crew_kit_events_insert
  on public.crew_kit_events for insert
  with check (
    actor_id = auth.uid()
    and (
      user_id = auth.uid()
      or exists (
        select 1 from public.tenant_members viewer
        join public.tenant_members subject on subject.tenant_id = viewer.tenant_id
        where viewer.user_id = auth.uid() and viewer.active = true
          and viewer.permission_tier = 'COMMAND'
          and subject.user_id = crew_kit_events.user_id
      )
    )
  );

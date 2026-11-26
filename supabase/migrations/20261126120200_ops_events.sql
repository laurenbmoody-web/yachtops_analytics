-- Ops / vessel calendar events move off the device.
--
-- They lived in localStorage ('cargo.ops-events.v1'), so an event one crew
-- member added was invisible to everyone else on board. This table makes the
-- calendar shared per vessel. Writes come through the offline outbox (device
-- ids from newId()), so ids are client-supplied uuids.
--
-- Visibility: private events are the creator's alone, enforced here. The finer
-- audience rules (All Hands / Chiefs / HODs / Crew / a department) stay in the
-- client filter, exactly as before.
create table if not exists public.ops_events (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  title           text not null,
  description     text not null default '',
  start_date      timestamptz not null,
  end_date        timestamptz,
  location        text not null default '',
  category        text not null default '',
  is_private      boolean not null default false,
  visibility      text[] not null default '{}',
  attachments     jsonb not null default '[]'::jsonb,
  activity        jsonb not null default '[]'::jsonb,
  created_by      uuid default auth.uid(),
  created_by_name text,
  edited_by       uuid,
  edited_by_name  text,
  edited_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists ops_events_tenant_start_idx on public.ops_events (tenant_id, start_date);

alter table public.ops_events enable row level security;

drop policy if exists ops_events_select on public.ops_events;
create policy ops_events_select on public.ops_events
  for select using (
    is_tenant_member(tenant_id) and (not is_private or created_by = auth.uid())
  );

drop policy if exists ops_events_insert on public.ops_events;
create policy ops_events_insert on public.ops_events
  for insert with check (
    is_tenant_member(tenant_id) and created_by = auth.uid()
  );

drop policy if exists ops_events_update on public.ops_events;
create policy ops_events_update on public.ops_events
  for update using (
    is_tenant_member(tenant_id) and (not is_private or created_by = auth.uid())
  ) with check (
    is_tenant_member(tenant_id) and (not is_private or created_by = auth.uid())
  );

drop policy if exists ops_events_delete on public.ops_events;
create policy ops_events_delete on public.ops_events
  for delete using (
    is_tenant_member(tenant_id) and (not is_private or created_by = auth.uid())
  );

grant select, insert, update, delete on public.ops_events to authenticated;

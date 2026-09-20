-- Steps: the small pieces inside one job.
--
-- To Do calls them Steps, Trello calls them a checklist, and the Jobs page has
-- had the control for a long time — you can add them and tick them and they
-- look saved. They were only ever held in React state and written to the
-- browser: fetchJobsFromSupabase sets `checklist: []` on every load, so the
-- steps vanished on the next refresh for their author and never existed at all
-- for the person the job was assigned to.
--
-- A job's steps are shared, the way the job is. Anyone who can see the job sees
-- them, and whoever is doing the work ticks them off.
--
-- Not to be confused with duty_task_progress, which is a rotation job's ticks
-- against a duty set template. That list comes from the template and is the
-- same every time the round comes round; these belong to this one job.

create table if not exists public.job_steps (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  job_id     uuid not null references public.team_jobs(id) on delete cascade,
  text       text not null,
  done       boolean not null default false,
  done_at    timestamptz,
  done_by    uuid,
  -- Ordering is explicit: steps are usually a sequence, and "wash" before
  -- "dry" is information that created_at loses the moment one is edited.
  position   integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_steps_job_idx
  on public.job_steps (job_id, position);

alter table public.job_steps enable row level security;

-- Any active member of the tenant, matching duty_task_progress and job_links:
-- the person doing the job is the one ticking its steps. Case-insensitive on
-- status, because the column holds lowercase 'active' and an exact 'ACTIVE'
-- comparison is what silently broke duty_set_templates.
create policy job_steps_select on public.job_steps
  for select using (
    tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true and upper(tm.status) = 'ACTIVE'
    )
  );

create policy job_steps_insert on public.job_steps
  for insert with check (
    tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true and upper(tm.status) = 'ACTIVE'
    )
  );

create policy job_steps_update on public.job_steps
  for update using (
    tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true and upper(tm.status) = 'ACTIVE'
    )
  );

create policy job_steps_delete on public.job_steps
  for delete using (
    tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true and upper(tm.status) = 'ACTIVE'
    )
  );

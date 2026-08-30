-- Per-job, per-task state for duty set jobs.
--
-- A rotation job already resolves to its template
-- (team_jobs.rotation_assignment_id -> rotation_assignments.duty_set_template_id
-- -> duty_set_templates.tasks), so the task LIST needs no storage. What was
-- missing is somewhere to record what the person actually did on the day:
-- which tasks they ticked and any note they left against one.
--
-- Keyed (job_id, task_id) so each day's job carries its own independent state —
-- ticking Monday's crew mess does not tick Tuesday's.
--
-- done_at is also what drives the "suggested before month end" hint: a monthly
-- task is surfaced when the most recent done_at for that task_id in the tenant
-- is more than three weeks ago, or has never happened.

create table if not exists public.duty_task_progress (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  job_id      uuid not null references public.team_jobs(id) on delete cascade,
  template_id uuid references public.duty_set_templates(id) on delete set null,
  task_id     text not null,
  done        boolean not null default false,
  done_at     timestamptz,
  done_by     uuid,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (job_id, task_id)
);

create index if not exists duty_task_progress_job_idx
  on public.duty_task_progress (job_id);

-- serves the "when was this task last done on this vessel" lookup
create index if not exists duty_task_progress_last_done_idx
  on public.duty_task_progress (tenant_id, template_id, task_id, done_at desc)
  where done = true;

alter table public.duty_task_progress enable row level security;

-- Read and write for any active member of the tenant. Deliberately NOT limited
-- to COMMAND/CHIEF/HOD: the crew member doing the round is the one ticking the
-- boxes. Case-insensitive on status — the column holds lowercase 'active', and
-- an exact-match 'ACTIVE' comparison is what silently broke duty_set_templates.
create policy duty_task_progress_select on public.duty_task_progress
  for select using (
    tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true and upper(tm.status) = 'ACTIVE'
    )
  );

create policy duty_task_progress_insert on public.duty_task_progress
  for insert with check (
    tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true and upper(tm.status) = 'ACTIVE'
    )
  );

create policy duty_task_progress_update on public.duty_task_progress
  for update using (
    tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true and upper(tm.status) = 'ACTIVE'
    )
  );

create policy duty_task_progress_delete on public.duty_task_progress
  for delete using (
    tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true and upper(tm.status) = 'ACTIVE'
    )
  );

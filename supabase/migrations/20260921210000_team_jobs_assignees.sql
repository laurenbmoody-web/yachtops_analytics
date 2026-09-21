-- More than one person on a job.
--
-- The detail pane has always shown "assignees" as an array, but team_jobs
-- only had assigned_to, a single uuid — so the picker was capped at one and
-- handleCardUpdate quietly wrote assignees[0] and dropped the rest. A crew
-- mess turnaround or a deep clean is two or three people; saying so meant
-- raising the job twice.
--
-- assigned_to stays, and stays authoritative as the FIRST assignee: every
-- board filter, the rota, the defect handover and the notification helpers
-- read it, and rewriting all of that to chase an array would be a much
-- larger change than the feature is worth. The array is the full list, the
-- column is its head, and both are written together.
alter table public.team_jobs add column if not exists assignees uuid[] not null default '{}';

-- "which jobs is this person on" is an array-contains query
create index if not exists team_jobs_assignees_idx on public.team_jobs using gin (assignees);

update public.team_jobs
   set assignees = array[assigned_to]
 where assigned_to is not null
   and (assignees is null or cardinality(assignees) = 0);

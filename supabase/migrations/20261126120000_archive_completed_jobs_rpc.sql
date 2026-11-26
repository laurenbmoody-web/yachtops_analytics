-- Jobs daily rollover: archive + remove completed jobs in ONE transaction.
--
-- The client used to insert into job_history and then delete from team_jobs as
-- two separate calls, without checking the insert's error (supabase-js returns
-- errors, it does not throw). A failed insert followed by a successful delete
-- lost completed jobs for good. This function moves the rows atomically with a
-- DELETE ... RETURNING feeding the INSERT, so either both happen or neither.
--
-- It only touches the ids the caller passes (the jobs visible on their boards),
-- keeping the old scope — duty/rotation jobs that never appear on a board are
-- not swept up. SECURITY INVOKER: team_jobs / job_history RLS still apply, so a
-- caller can only archive jobs they could already delete. Two devices running
-- the rollover at once is safe: the second DELETE finds nothing to move.
create or replace function public.archive_completed_jobs(
  p_tenant_id uuid,
  p_job_ids uuid[]
)
returns integer
language sql
security invoker
set search_path = public
as $$
  with moved as (
    delete from public.team_jobs
     where tenant_id = p_tenant_id
       and id = any(p_job_ids)
       and status = 'completed'
    returning *
  ), ins as (
    insert into public.job_history (
      tenant_id, original_job_id, title, description, priority,
      department_id, department, board_id, board_name,
      assigned_to, created_by, completed_by, completed_at, completion_date, metadata
    )
    select m.tenant_id, m.id, coalesce(nullif(m.title, ''), 'Untitled'), m.description, m.priority,
           m.department_id, m.department_id::text, m.board_id::text, b.name,
           m.assigned_to, m.created_by, m.completed_by,
           coalesce(m.completed_at, now()),
           coalesce(m.completion_date, m.completed_at::date, current_date),
           coalesce(m.metadata, '[]'::jsonb)
      from moved m
      left join public.job_boards b on b.id = m.board_id::text
    returning 1
  )
  select count(*)::integer from ins;
$$;

revoke all on function public.archive_completed_jobs(uuid, uuid[]) from public, anon;
grant execute on function public.archive_completed_jobs(uuid, uuid[]) to authenticated;

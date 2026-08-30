-- Stop attributing rotation jobs to an arbitrary chief.
--
-- When the caller passed no created_by, this function filled it with
--
--   select user_id from tenant_members
--   where tenant_id = p_tenant_id and active and permission_tier in ('COMMAND','CHIEF')
--   limit 1
--
-- LIMIT 1 with no ORDER BY is whatever row Postgres reaches first, so every
-- rotation job on a vessel got stamped with the same unlucky person's name and
-- the job card reported them as its creator. That is a false audit record: it
-- names someone who did not create the job, and it is stable enough to look
-- deliberate.
--
-- created_by is NOT NULL, so the function still needs a value. The assigned
-- member is the honest one — the round is theirs — and it is what the function
-- already fell back to when the tenant had no chief at all. This just removes
-- the guess in between.

create or replace function public.sync_rotation_job(
  p_assignment_id uuid,
  p_tenant_id uuid,
  p_department_id uuid,
  p_member_id uuid,
  p_date date,
  p_title text,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
as $function$
DECLARE
  v_job_id UUID;
BEGIN
  -- Validate required fields
  IF p_tenant_id IS NULL OR p_member_id IS NULL OR p_date IS NULL OR p_title IS NULL THEN
    RAISE NOTICE 'sync_rotation_job: missing required fields (tenant_id=%, member_id=%, date=%, title=%)',
      p_tenant_id, p_member_id, p_date, p_title;
    RETURN NULL;
  END IF;

  -- created_by is NOT NULL. With no caller supplied, the round's own member is
  -- the only defensible answer — never some other member picked at random.
  IF p_created_by IS NULL THEN
    p_created_by := p_member_id;
  END IF;

  -- Check if a job already exists for this assignment
  IF p_assignment_id IS NOT NULL THEN
    SELECT id INTO v_job_id
    FROM public.team_jobs
    WHERE rotation_assignment_id = p_assignment_id
      AND source = 'rotation'
    LIMIT 1;
  END IF;

  -- Also check by member + date + source + title if no assignment match
  IF v_job_id IS NULL THEN
    SELECT id INTO v_job_id
    FROM public.team_jobs
    WHERE tenant_id = p_tenant_id
      AND assigned_to = p_member_id
      AND due_date = p_date
      AND source = 'rotation'
      AND title = p_title
    LIMIT 1;
  END IF;

  IF v_job_id IS NOT NULL THEN
    -- Update existing job
    UPDATE public.team_jobs
    SET
      title = p_title,
      assigned_to = p_member_id,
      due_date = p_date,
      department_id = p_department_id,
      updated_at = now()
    WHERE id = v_job_id;

    -- Update assignment link if provided
    IF p_assignment_id IS NOT NULL THEN
      UPDATE public.rotation_assignments
      SET linked_job_id = v_job_id
      WHERE id = p_assignment_id AND linked_job_id IS NULL;
    END IF;

    RETURN v_job_id;
  ELSE
    -- Insert new job
    INSERT INTO public.team_jobs (
      tenant_id,
      department_id,
      title,
      assigned_to,
      due_date,
      status,
      source,
      rotation_assignment_id,
      created_by,
      is_private,
      cross_dept_status,
      created_at,
      updated_at
    ) VALUES (
      p_tenant_id,
      p_department_id,
      p_title,
      p_member_id,
      p_date,
      'OPEN',
      'rotation',
      p_assignment_id,
      p_created_by,
      false,
      'NONE',
      now(),
      now()
    )
    RETURNING id INTO v_job_id;

    -- Update the rotation_assignment with the linked_job_id
    IF p_assignment_id IS NOT NULL THEN
      UPDATE public.rotation_assignments
      SET linked_job_id = v_job_id
      WHERE id = p_assignment_id;
    END IF;

    RETURN v_job_id;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'sync_rotation_job error for assignment %: %', p_assignment_id, SQLERRM;
    RETURN NULL;
END;
$function$;

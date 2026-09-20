-- "No eligible crew in this department" — on a department full of crew.
--
-- get_tenant_members_for_jobs is what every job modal asks for its assignee
-- list. Both of its predicates compared tm.status = 'ACTIVE' in upper case,
-- and the column holds lowercase 'active'. So the membership check at the top
-- matched nobody and the function RAISED 'Access denied' for every caller,
-- including a Captain asking about her own vessel. The client logs the error
-- and falls back to an empty list, which is why the modal reported that a
-- department with four active crew had none — the same upper-case comparison
-- that silently broke duty_set_templates.
--
-- upper() on both, matching the convention the RLS policies use.
create or replace function public.get_tenant_members_for_jobs(
  p_tenant_id uuid,
  p_department_id uuid default null::uuid
)
returns table(user_id uuid, department_id uuid, permission_tier text)
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  -- Verify the caller is an active member of this tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = auth.uid()
      AND tm.active = true
      AND upper(tm.status) = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Access denied: caller is not an active member of this tenant';
  END IF;

  -- Return members, optionally filtered by department
  RETURN QUERY
  SELECT
    tm.user_id,
    tm.department_id,
    tm.permission_tier::TEXT
  FROM public.tenant_members tm
  WHERE tm.tenant_id = p_tenant_id
    AND tm.active = true
    AND upper(tm.status) = 'ACTIVE'
    AND (
      p_department_id IS NULL
      OR tm.department_id = p_department_id
    );
END;
$function$;

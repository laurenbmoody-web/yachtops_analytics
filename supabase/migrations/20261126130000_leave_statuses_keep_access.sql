-- Crew on leave keep their access — all of it, not just get_my_context().
--
-- tenant_members.status is a crew lifecycle label ('active', 'on_leave',
-- 'rotational_leave', 'medical_leave', 'training', 'travelling', 'invited').
-- Access is `active = true` (false = left the vessel / archived). A set of RLS
-- policies and one RPC also required `upper(tm.status) = 'ACTIVE'`, so anyone
-- marked on leave, training or travelling lost:
--   job steps, checklist items, links, reminders, duty-set templates and duty
--   task progress (24 policies), and
--   get_tenant_members_for_jobs (raised "Access denied" when they opened a job
--   or defect form, and left them out of the assignee / notify lists).
--
-- Replace that predicate with "not an unaccepted invite", matching
-- 20261126120100_get_my_context_leave_statuses. Policies are edited in place
-- with ALTER POLICY, so their command, roles and every other condition stay
-- exactly as they were.
do $$
declare
  p record;
  old_pred constant text := $q$(upper(tm.status) = 'ACTIVE'::text)$q$;
  new_pred constant text := $q$(lower(COALESCE(tm.status, 'active'::text)) <> 'invited'::text)$q$;
  stmt text;
begin
  for p in
    select tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') || coalesce(with_check, '')) like '%' || old_pred || '%'
  loop
    stmt := format('alter policy %I on public.%I', p.policyname, p.tablename);
    if p.qual is not null then
      stmt := stmt || ' using (' || replace(p.qual, old_pred, new_pred) || ')';
    end if;
    if p.with_check is not null then
      stmt := stmt || ' with check (' || replace(p.with_check, old_pred, new_pred) || ')';
    end if;
    execute stmt;
  end loop;
end $$;

create or replace function public.get_tenant_members_for_jobs(
  p_tenant_id uuid,
  p_department_id uuid default null
)
returns table(user_id uuid, department_id uuid, permission_tier text)
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = auth.uid()
      AND tm.active = true
      AND lower(COALESCE(tm.status, 'active')) <> 'invited'
  ) THEN
    RAISE EXCEPTION 'Access denied: caller is not an active member of this tenant';
  END IF;

  RETURN QUERY
  SELECT tm.user_id, tm.department_id, tm.permission_tier::TEXT
  FROM public.tenant_members tm
  WHERE tm.tenant_id = p_tenant_id
    AND tm.active = true
    AND lower(COALESCE(tm.status, 'active')) <> 'invited'
    AND (p_department_id IS NULL OR tm.department_id = p_department_id);
END;
$function$;

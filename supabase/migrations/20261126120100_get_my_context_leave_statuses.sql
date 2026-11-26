-- get_my_context(): stop demoting crew who are on leave / travelling / training.
--
-- 20260818213000 fixed the case of the status filter (UPPER(tm.status) =
-- 'ACTIVE'), but the filter itself is the problem logged in
-- docs/known-issues.md: tenant_members.status is a crew *lifecycle* label
-- ('active', 'on_leave', 'rotational_leave', 'medical_leave', 'training',
-- 'travelling', 'invited'), not an access gate. A COMMAND member marked
-- 'on_leave' got a NULL role here and every caller fell back to its
-- least-privileged default.
--
-- The rest of the stack — AuthContext, hasCommandAccess(), and the RLS policies —
-- treats `active = true` + permission_tier as the source of truth. Align with
-- that (option (a) in known-issues). The one status still excluded is
-- 'invited': an invite that hasn't been accepted should never resolve a role.
create or replace function public.get_my_context()
returns table(user_id uuid, tenant_id uuid, role text)
language plpgsql
security definer
set search_path = public
as $function$
DECLARE
    v_user_id UUID;
    v_tenant_id UUID;
    v_role TEXT;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;

    SELECT last_active_tenant_id INTO v_tenant_id
    FROM public.profiles
    WHERE id = v_user_id;

    IF v_tenant_id IS NULL THEN
        RETURN QUERY SELECT v_user_id, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;

    SELECT
        COALESCE(
            tm.permission_tier,
            tm.permission_tier_override,
            'VIEW_ONLY'
        ) INTO v_role
    FROM public.tenant_members tm
    WHERE tm.user_id = v_user_id
      AND tm.tenant_id = v_tenant_id
      AND tm.active = true
      AND LOWER(COALESCE(tm.status, 'active')) <> 'invited'
    LIMIT 1;

    RETURN QUERY SELECT v_user_id, v_tenant_id, v_role;
END;
$function$;

grant execute on function public.get_my_context() to authenticated, service_role;

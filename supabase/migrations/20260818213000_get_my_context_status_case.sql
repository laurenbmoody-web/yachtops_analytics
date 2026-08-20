-- get_my_context() returned a NULL role for every user on the vessel.
--
-- The membership lookup filtered `tm.status = 'ACTIVE'`, but tenant_members.status
-- is constrained to lowercase values ('active', 'on_leave', 'rotational_leave',
-- 'medical_leave', 'training', 'travelling', 'invited') by
-- tenant_members_status_check — so that predicate could never match a single row,
-- whatever the crew member's actual tier. Every caller of this RPC therefore fell
-- back to its least-privileged default: on the vessel settings page that meant
-- `contextData?.role || 'CREW'`, locking even the vessel's own Command to
-- "View-only — only Command can edit the vessel record."
--
-- Compare case-insensitively so the filter means what it says. Semantics are
-- otherwise unchanged: an active membership whose status is 'active', and the
-- same permission_tier → permission_tier_override → VIEW_ONLY fallback chain.
create or replace function public.get_my_context()
returns table(user_id uuid, tenant_id uuid, role text)
language plpgsql
security definer
as $function$
DECLARE
    v_user_id UUID;
    v_tenant_id UUID;
    v_role TEXT;
BEGIN
    -- Get authenticated user ID
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;

    -- Get active tenant from profile
    SELECT last_active_tenant_id INTO v_tenant_id
    FROM public.profiles
    WHERE id = v_user_id;

    -- If no active tenant, return null for tenant_id and role
    IF v_tenant_id IS NULL THEN
        RETURN QUERY SELECT v_user_id, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;

    -- Get effective permission tier from tenant_members
    -- Use permission_tier as primary source, with fallback chain
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
      AND UPPER(tm.status) = 'ACTIVE'
    LIMIT 1;

    -- Return context (role defaults to null if no membership found)
    RETURN QUERY SELECT v_user_id, v_tenant_id, v_role;
END;
$function$;

grant execute on function public.get_my_context() to authenticated, service_role;

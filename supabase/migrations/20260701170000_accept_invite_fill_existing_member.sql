-- Role / Department / Permission still not landing for some joins.
--
-- accept_crew_invite_v3 has an "already a member" fast-path: if an active
-- tenant_members row already exists for the user+tenant, it marks the invite
-- accepted and returns WITHOUT touching role/department/permission. So when a
-- bare membership row exists before acceptance (default permission_tier 'CREW',
-- null role/department), accepting the invite leaves it blank — the profile
-- Contract tab, meta bar and nav all show "—" while only the tier shows.
--
-- Fix: in that fast-path, fill in role/department/permission FROM THE INVITE for
-- any field the existing row is missing (only fills blanks — an explicit role
-- already set is preserved). The INSERT path (new rows) already carries these.
-- A one-off backfill at the end repairs members who already joined blank.
create or replace function public.accept_crew_invite_v3(p_token text, p_full_name text default null::text)
 returns table(success boolean, tenant_id uuid, role text, role_id uuid, job_title_id text, job_title_label text, message text)
 language plpgsql
 security definer
as $function$
DECLARE
    v_invite_record       RECORD;
    v_user_email          TEXT;
    v_user_id             UUID;
    v_out_tenant_id       UUID;
    v_out_role            TEXT;
    v_out_role_id         UUID;
    v_out_custom_role_id  UUID;
    v_out_job_title_id    TEXT;
    v_out_job_title_label TEXT;
    v_out_department_id   UUID;
    v_out_permission_tier TEXT;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false::BOOLEAN, NULL::UUID, NULL::TEXT, NULL::UUID,
                            NULL::TEXT, NULL::TEXT, 'Not authenticated'::TEXT;
        RETURN;
    END IF;

    SELECT p.email INTO v_user_email
    FROM public.profiles p
    WHERE p.id = v_user_id;

    IF v_user_email IS NULL THEN
        RETURN QUERY SELECT false::BOOLEAN, NULL::UUID, NULL::TEXT, NULL::UUID,
                            NULL::TEXT, NULL::TEXT, 'User profile not found'::TEXT;
        RETURN;
    END IF;

    -- Lock the invite row (NULL-safe expires_at check)
    SELECT ci.* INTO v_invite_record
    FROM public.crew_invites ci
    WHERE ci.token  = p_token
      AND ci.status = 'PENDING'
      AND (ci.expires_at IS NULL OR ci.expires_at > NOW())
    FOR UPDATE;

    IF v_invite_record.id IS NULL THEN
        RETURN QUERY SELECT false::BOOLEAN, NULL::UUID, NULL::TEXT, NULL::UUID,
                            NULL::TEXT, NULL::TEXT,
                            'Invite invalid, expired, or already used'::TEXT;
        RETURN;
    END IF;

    IF LOWER(v_user_email) != LOWER(v_invite_record.email) THEN
        RETURN QUERY SELECT false::BOOLEAN, NULL::UUID, NULL::TEXT, NULL::UUID,
                            NULL::TEXT, NULL::TEXT,
                            'This invite is not for your email address'::TEXT;
        RETURN;
    END IF;

    v_out_tenant_id       := v_invite_record.tenant_id;
    v_out_role            := v_invite_record.invited_role;
    v_out_role_id         := v_invite_record.role_id;
    v_out_custom_role_id  := v_invite_record.custom_role_id;
    v_out_job_title_id    := v_invite_record.job_title_id;
    v_out_job_title_label := v_invite_record.job_title_label;
    v_out_department_id   := v_invite_record.department_id;
    v_out_permission_tier := COALESCE(
        v_invite_record.permission_tier,
        v_invite_record.invited_role
    );

    IF v_out_role_id IS NULL
       AND v_out_custom_role_id IS NULL
       AND v_out_department_id IS NOT NULL
       AND v_invite_record.role_label IS NOT NULL
    THEN
        SELECT r.id INTO v_out_role_id
        FROM public.roles r
        WHERE r.department_id = v_out_department_id
          AND r.name           = v_invite_record.role_label
        LIMIT 1;
    END IF;

    IF p_full_name IS NOT NULL AND p_full_name != '' THEN
        UPDATE public.profiles
        SET full_name = p_full_name
        WHERE id = v_user_id;
    END IF;

    -- Already a member — fill any missing role/department/permission from the
    -- invite (so a bare pre-existing row gets populated), mark accepted, return.
    IF EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = v_out_tenant_id
          AND tm.user_id   = v_user_id
          AND tm.active    = true
    ) THEN
        UPDATE public.tenant_members tm
        SET role_id        = CASE WHEN tm.role_id IS NULL AND tm.custom_role_id IS NULL
                                  THEN v_out_role_id ELSE tm.role_id END,
            custom_role_id = CASE WHEN tm.role_id IS NULL AND tm.custom_role_id IS NULL
                                  THEN v_out_custom_role_id ELSE tm.custom_role_id END,
            department_id  = COALESCE(tm.department_id, v_out_department_id),
            permission_tier= COALESCE(tm.permission_tier, v_out_permission_tier),
            role           = COALESCE(tm.role, v_out_role),
            role_legacy    = COALESCE(tm.role_legacy, v_out_role)
        WHERE tm.tenant_id = v_out_tenant_id
          AND tm.user_id   = v_user_id;

        UPDATE public.crew_invites
        SET status      = 'ACCEPTED',
            accepted_at = NOW(),
            accepted_by = v_user_id
        WHERE id = v_invite_record.id;

        RETURN QUERY SELECT true::BOOLEAN, v_out_tenant_id, v_out_role, v_out_role_id,
                            v_out_job_title_id, v_out_job_title_label,
                            'Already a member'::TEXT;
        RETURN;
    END IF;

    -- Create membership. status must be lowercase to satisfy
    -- tenant_members_status_check; a future start_date starts them as 'invited'.
    INSERT INTO public.tenant_members (
        tenant_id, user_id,
        role, role_id, custom_role_id, role_legacy,
        department_id, permission_tier,
        active, status, start_date
    )
    VALUES (
        v_out_tenant_id,
        v_user_id,
        v_out_role,
        v_out_role_id,
        v_out_custom_role_id,
        v_out_role,
        v_out_department_id,
        v_out_permission_tier,
        true,
        CASE
            WHEN v_invite_record.start_date IS NOT NULL
                 AND v_invite_record.start_date > CURRENT_DATE
            THEN 'invited'
            ELSE 'active'
        END,
        v_invite_record.start_date
    );

    UPDATE public.crew_invites
    SET status      = 'ACCEPTED',
        accepted_at = NOW(),
        accepted_by = v_user_id
    WHERE id = v_invite_record.id;

    UPDATE public.profiles
    SET last_active_tenant_id = v_out_tenant_id
    WHERE id = v_user_id;

    RETURN QUERY SELECT true::BOOLEAN, v_out_tenant_id, v_out_role, v_out_role_id,
                        v_out_job_title_id, v_out_job_title_label,
                        'Invite accepted successfully'::TEXT;

EXCEPTION
    WHEN OTHERS THEN
        RETURN QUERY SELECT false::BOOLEAN, NULL::UUID, NULL::TEXT, NULL::UUID,
                            NULL::TEXT, NULL::TEXT, SQLERRM::TEXT;
END;
$function$;

-- One-off repair: fill blank members from the invite they accepted (re-run of
-- the earlier backfill, to catch anyone who joined blank after it last ran).
update public.tenant_members tm
set department_id   = coalesce(tm.department_id, inv.department_id),
    role_id         = inv.role_id,
    custom_role_id  = inv.custom_role_id,
    permission_tier = coalesce(tm.permission_tier, inv.permission_tier)
from (
  select distinct on (accepted_by, tenant_id)
         accepted_by, tenant_id, department_id, role_id, custom_role_id, permission_tier
  from public.crew_invites
  where status = 'ACCEPTED'
    and accepted_by is not null
  order by accepted_by, tenant_id, accepted_at desc
) inv
where inv.accepted_by = tm.user_id
  and inv.tenant_id   = tm.tenant_id
  and tm.role_id       is null
  and tm.custom_role_id is null
  and (inv.role_id is not null or inv.custom_role_id is not null);

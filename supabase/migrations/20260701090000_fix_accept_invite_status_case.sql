-- Fix crew invite acceptance: the RPC inserted tenant_members.status = 'ACTIVE'
-- (uppercase), which violates tenant_members_status_check (allowed values are
-- lowercase: active/on_leave/rotational_leave/medical_leave/training/travelling/
-- invited). Every join therefore failed with a check-constraint error.
--
-- Fix: insert lowercase 'active' — and honour a future start_date on the invite
-- by inserting 'invited' until that date arrives (matching the invite UI copy).
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
    v_out_job_title_id    := v_invite_record.job_title_id;
    v_out_job_title_label := v_invite_record.job_title_label;
    v_out_department_id   := v_invite_record.department_id;
    v_out_permission_tier := COALESCE(
        v_invite_record.permission_tier,
        v_invite_record.invited_role
    );

    IF v_out_role_id IS NULL
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

    -- Already a member — mark invite accepted and return early
    IF EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = v_out_tenant_id
          AND tm.user_id   = v_user_id
          AND tm.active    = true
    ) THEN
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
        role, role_id, role_legacy,
        department_id, permission_tier,
        active, status, start_date
    )
    VALUES (
        v_out_tenant_id,
        v_user_id,
        v_out_role,
        v_out_role_id,
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

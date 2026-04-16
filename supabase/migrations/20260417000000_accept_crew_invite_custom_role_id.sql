-- Migration: Rebuild accept_crew_invite_v3 to copy custom_role_id onto tenant_members
-- Date: 2026-04-17
--
-- tenant_custom_roles now holds tenant-scoped roles (the "Other" free-text role
-- a captain types during invite, plus any role they create in vessel settings →
-- role management). Both crew_invites and tenant_members gained a
-- custom_role_id UUID FK to tenant_custom_roles; exactly one of role_id /
-- custom_role_id should ever be populated on a given row.
--
-- The RPC now:
--   1. Copies v_invite_record.custom_role_id into the tenant_members INSERT.
--   2. Keeps the existing fallback role resolution (when role_id is null,
--      department_id is a valid UUID, and role_label matches a global role).
--      If the invite already has custom_role_id, we skip the global-catalog
--      lookup to avoid setting both columns.
--   3. Preserves every other branch (already-a-member, email mismatch, expiry,
--      profile updates, invite-accepted bookkeeping).
--
-- The sync_tenant_member_permission_tier BEFORE INSERT/UPDATE trigger already
-- understands both role_id and custom_role_id, so permission_tier is derived
-- correctly regardless of which column is set.

DROP FUNCTION IF EXISTS public.accept_crew_invite_v3(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.accept_crew_invite_v3(
    p_token     TEXT,
    p_full_name TEXT DEFAULT NULL
)
RETURNS TABLE(
    success         BOOLEAN,
    tenant_id       UUID,
    role            TEXT,
    role_id         UUID,
    job_title_id    TEXT,
    job_title_label TEXT,
    message         TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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

    -- Capture all invite fields into unambiguous local variables
    v_out_tenant_id       := v_invite_record.tenant_id;
    v_out_role            := v_invite_record.invited_role;
    v_out_role_id         := v_invite_record.role_id;
    v_out_custom_role_id  := v_invite_record.custom_role_id;
    v_out_job_title_id    := v_invite_record.job_title_id;
    v_out_job_title_label := v_invite_record.job_title_label;
    v_out_department_id   := v_invite_record.department_id;
    -- Use permission_tier from invite if set, otherwise derive from invited_role.
    -- The tenant_members BEFORE INSERT trigger will still overwrite this based on
    -- role_id / custom_role_id lookups; the value here is just the fallback.
    v_out_permission_tier := COALESCE(
        v_invite_record.permission_tier,
        v_invite_record.invited_role
    );

    -- Fallback: if neither role_id nor custom_role_id is set but we have a
    -- department_id UUID and a role_label, try to resolve a global role from
    -- public.roles. Custom roles are created explicitly at invite-insert time,
    -- so if custom_role_id is already populated we skip this lookup.
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

    -- Create membership — exactly one of role_id / custom_role_id will be set.
    INSERT INTO public.tenant_members (
        tenant_id, user_id,
        role, role_id, custom_role_id, role_legacy,
        department_id, permission_tier,
        active, status
    )
    VALUES (
        v_out_tenant_id,
        v_user_id,
        v_out_role,
        v_out_role_id,
        v_out_custom_role_id,
        v_out_role,                 -- role_legacy mirrors role (NOT NULL column)
        v_out_department_id,
        v_out_permission_tier,
        true,
        'ACTIVE'
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
$$;

GRANT EXECUTE ON FUNCTION public.accept_crew_invite_v3(TEXT, TEXT) TO authenticated;

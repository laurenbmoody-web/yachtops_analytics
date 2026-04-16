-- Migration: Fix crew invite acceptance — nullable role_id + role resolution in accept RPC
-- Date: 2026-04-16
--
-- Root cause (two-part):
--
--   1. tenant_members.role_id was made NOT NULL outside tracked migrations (via Supabase
--      dashboard). The original column addition (20260217185500) was nullable. Any invite
--      row whose crew_invites.role_id is NULL causes the INSERT to reject.
--
--   2. Invites created from the onboarding flow always have crew_invites.role_id = NULL.
--      The onboarding department picker stores string keys ('BRIDGE', 'GALLEY', …) as
--      department_id. These are not UUIDs, so the roles-table lookup
--      (WHERE department_id IN ('BRIDGE', …)) returns nothing, matchedRole is always
--      undefined, and roleId is always null at invite-insert time.
--
-- Fix:
--   Step 1 — DROP NOT NULL from tenant_members.role_id.
--             role_id remains a FK to roles; the column is just nullable again, matching
--             the original migration intent. Existing rows with a non-null role_id are
--             completely unaffected.
--
--   Step 2 — Rebuild accept_crew_invite_v3 to attempt role resolution from the roles
--             catalog when crew_invites.role_id is NULL but role_label + department_id
--             are present. Falls back to NULL silently (safe — column is now nullable).
--             This fixes end-to-end acceptance for:
--               • Predefined roles invited via crew management (role_id already set).
--               • Predefined roles invited via crew management where department_id is a
--                 valid UUID — resolution fills in role_id at accept time.
--               • "Other" / free-text roles — role_id stays NULL, role text preserved.

-- ── 1. Restore nullable on tenant_members.role_id ────────────────────────────

ALTER TABLE public.tenant_members
  ALTER COLUMN role_id DROP NOT NULL;

-- ── 2. Rebuild accept_crew_invite_v3 ─────────────────────────────────────────

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
    v_out_job_title_id    := v_invite_record.job_title_id;
    v_out_job_title_label := v_invite_record.job_title_label;
    v_out_department_id   := v_invite_record.department_id;
    -- Use permission_tier from invite if set, otherwise derive from invited_role
    v_out_permission_tier := COALESCE(
        v_invite_record.permission_tier,
        v_invite_record.invited_role
    );

    -- Attempt to resolve role_id from the roles catalog when it is missing.
    -- This covers invites where role_id was not stored at invite-insert time
    -- (e.g. legacy invites or the onboarding path). Requires both a valid
    -- department_id UUID and a role_label on the invite row.
    -- Fails silently — tenant_members.role_id is nullable, so the INSERT
    -- succeeds even when no match is found (free-text "Other" roles).
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

    -- Create membership
    -- role_id is nullable: NULL for "Other"/free-text roles, UUID for structured roles
    INSERT INTO public.tenant_members (
        tenant_id, user_id,
        role, role_id, role_legacy,
        department_id, permission_tier,
        active, status
    )
    VALUES (
        v_out_tenant_id,
        v_user_id,
        v_out_role,
        v_out_role_id,          -- NULL allowed (column is nullable)
        v_out_role,             -- role_legacy mirrors role (NOT NULL column)
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

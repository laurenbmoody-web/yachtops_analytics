-- Migration: Fix accept_crew_invite_v3 missing department_id in tenant_members INSERT
-- Root cause: The INSERT into tenant_members never included department_id, so all crew
-- members accepted via v3 had NULL department_id, causing fallback to first department.
-- Fix: Capture department_id from v_invite_record into a local variable and include it
-- in the INSERT, matching the pattern already used in accept_crew_invite_v2.
-- Date: 2026-02-27

-- Drop existing v3 function
DROP FUNCTION IF EXISTS public.accept_crew_invite_v3(TEXT, TEXT);

-- Recreate with department_id included in INSERT
CREATE OR REPLACE FUNCTION public.accept_crew_invite_v3(p_token TEXT, p_full_name TEXT DEFAULT NULL)
RETURNS TABLE(
    success BOOLEAN,
    tenant_id UUID,
    role TEXT,
    role_id UUID,
    job_title_id TEXT,
    job_title_label TEXT,
    message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_invite_record RECORD;
    v_user_email    TEXT;
    v_user_id       UUID;
    -- Local copies of every value we will return, typed to match RETURNS TABLE exactly.
    -- This prevents PostgreSQL from confusing output-column names (tenant_id, role, role_id)
    -- with the identically-named fields on v_invite_record inside RETURN QUERY SELECT.
    v_out_tenant_id       UUID;
    v_out_role            TEXT;
    v_out_role_id         UUID;
    v_out_job_title_id    TEXT;
    v_out_job_title_label TEXT;
    v_out_department_id   UUID;  -- captured separately so INSERT can reference it unambiguously
BEGIN
    -- Get current user info
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false::BOOLEAN, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT, 'Not authenticated'::TEXT;
        RETURN;
    END IF;

    -- Get user email from profiles
    SELECT p.email INTO v_user_email
    FROM public.profiles p
    WHERE p.id = v_user_id;

    IF v_user_email IS NULL THEN
        RETURN QUERY SELECT false::BOOLEAN, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT, 'User profile not found'::TEXT;
        RETURN;
    END IF;

    -- Find the invite (NULL-safe expires_at check)
    SELECT ci.* INTO v_invite_record
    FROM public.crew_invites ci
    WHERE ci.token = p_token
      AND ci.status = 'PENDING'
      AND (ci.expires_at IS NULL OR ci.expires_at > NOW())
    FOR UPDATE;

    -- Validate invite exists
    IF v_invite_record.id IS NULL THEN
        RETURN QUERY SELECT false::BOOLEAN, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT, 'Invite invalid, expired, or already used'::TEXT;
        RETURN;
    END IF;

    -- Validate email matches
    IF LOWER(v_user_email) != LOWER(v_invite_record.email) THEN
        RETURN QUERY SELECT false::BOOLEAN, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT, 'This invite is not for your email address'::TEXT;
        RETURN;
    END IF;

    -- Capture return values into unambiguous local variables
    v_out_tenant_id       := v_invite_record.tenant_id;
    v_out_role            := v_invite_record.invited_role;
    v_out_role_id         := v_invite_record.role_id;
    v_out_job_title_id    := v_invite_record.job_title_id;
    v_out_job_title_label := v_invite_record.job_title_label;
    v_out_department_id   := v_invite_record.department_id;  -- FIX: capture department_id

    -- Update profiles with full_name if provided
    IF p_full_name IS NOT NULL AND p_full_name != '' THEN
        UPDATE public.profiles
        SET full_name = p_full_name
        WHERE id = v_user_id;
    END IF;

    -- Check if user is already a member of this tenant
    IF EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = v_out_tenant_id
          AND tm.user_id   = v_user_id
          AND tm.active    = true
    ) THEN
        -- Mark invite as accepted anyway
        UPDATE public.crew_invites
        SET status      = 'ACCEPTED',
            accepted_at = NOW(),
            accepted_by = v_user_id
        WHERE id = v_invite_record.id;

        RETURN QUERY SELECT true::BOOLEAN, v_out_tenant_id, v_out_role, v_out_role_id, v_out_job_title_id, v_out_job_title_label, 'Already a member'::TEXT;
        RETURN;
    END IF;

    -- Create tenant membership — FIX: department_id is now included
    INSERT INTO public.tenant_members (tenant_id, user_id, role, role_id, role_legacy, department_id, active, status)
    VALUES (
        v_out_tenant_id,
        v_user_id,
        v_out_role,
        v_out_role_id,
        v_out_role,            -- role_legacy mirrors role (NOT NULL constraint)
        v_out_department_id,   -- FIX: was missing, causing NULL department_id on all v3 acceptances
        true,
        'ACTIVE'
    );

    -- Update invite status
    UPDATE public.crew_invites
    SET status      = 'ACCEPTED',
        accepted_at = NOW(),
        accepted_by = v_user_id
    WHERE id = v_invite_record.id;

    -- Update user's last_active_tenant_id
    UPDATE public.profiles
    SET last_active_tenant_id = v_out_tenant_id
    WHERE id = v_user_id;

    -- Return success — all values come from local variables, no output-column name collision
    RETURN QUERY SELECT true::BOOLEAN, v_out_tenant_id, v_out_role, v_out_role_id, v_out_job_title_id, v_out_job_title_label, 'Invite accepted successfully'::TEXT;

EXCEPTION
    WHEN OTHERS THEN
        RETURN QUERY SELECT false::BOOLEAN, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT, SQLERRM::TEXT;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.accept_crew_invite_v3(TEXT, TEXT) TO authenticated;

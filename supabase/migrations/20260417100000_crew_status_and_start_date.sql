-- Migration: New crew status system + start_date columns
-- Date: 2026-04-17
--
-- 1. Adds start_date DATE to crew_invites and tenant_members.
-- 2. Migrates existing uppercase status values to the new lowercase scheme.
-- 3. Replaces the old status check constraint with the six new statuses.
-- 4. Updates accept_crew_invite_v3 to set status='invited'/'active' based on start_date.
-- 5. Updates get_my_context and get_tenant_members_for_jobs to drop the now-stale
--    status='ACTIVE' filter (active=true is the real membership gate).

-- ────────────────────────────────────────────────────────────
-- 1. Column additions
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.crew_invites   ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE public.tenant_members ADD COLUMN IF NOT EXISTS start_date DATE;

-- ────────────────────────────────────────────────────────────
-- 2. Data migration
--    ACTIVE   → active  (on board)
--    INVITED  → invited (accepted but hasn't started)
--    INACTIVE → active  (archived rows have active=false; status column value is irrelevant)
-- ────────────────────────────────────────────────────────────
UPDATE public.tenant_members
SET status = CASE
    WHEN status = 'ACTIVE'   THEN 'active'
    WHEN status = 'INVITED'  THEN 'invited'
    WHEN status = 'INACTIVE' THEN 'active'
    ELSE 'active'
END
WHERE status IN ('ACTIVE', 'INACTIVE', 'INVITED');

-- ────────────────────────────────────────────────────────────
-- 3. Constraint replacement
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.tenant_members DROP CONSTRAINT IF EXISTS tenant_members_status_check;
ALTER TABLE public.tenant_members ADD CONSTRAINT tenant_members_status_check
    CHECK (status IN ('active', 'on_leave', 'rotational_leave', 'medical_leave', 'training', 'invited'));

-- ────────────────────────────────────────────────────────────
-- 4. Rebuild accept_crew_invite_v3
--    New behaviour:
--      • Copies start_date from the invite onto tenant_members.
--      • Sets status = 'invited'  when start_date is in the future.
--      • Sets status = 'active'   when start_date is today, past, or NULL.
-- ────────────────────────────────────────────────────────────
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
    v_out_start_date      DATE;
    v_out_status          TEXT;
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
    v_out_start_date      := v_invite_record.start_date;
    v_out_permission_tier := COALESCE(
        v_invite_record.permission_tier,
        v_invite_record.invited_role
    );

    -- Determine initial status based on start_date
    IF v_out_start_date IS NOT NULL AND v_out_start_date > CURRENT_DATE THEN
        v_out_status := 'invited';
    ELSE
        v_out_status := 'active';
    END IF;

    -- Fallback: resolve global role_id from role_label when neither FK is set
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

    -- Create membership
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
        v_out_status,
        v_out_start_date
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

-- ────────────────────────────────────────────────────────────
-- 5. Update get_my_context: drop status='ACTIVE' filter
--    active=true already gates membership; status is now a display-only field.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_context()
RETURNS TABLE (
    user_id UUID,
    tenant_id UUID,
    role TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id   UUID;
    v_tenant_id UUID;
    v_role      TEXT;
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

    SELECT COALESCE(tm.permission_tier, tm.permission_tier_override, 'VIEW_ONLY') INTO v_role
    FROM public.tenant_members tm
    WHERE tm.user_id   = v_user_id
      AND tm.tenant_id = v_tenant_id
      AND tm.active    = true
    LIMIT 1;

    RETURN QUERY SELECT v_user_id, v_tenant_id, v_role;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 6. Update get_tenant_members_for_jobs: drop status='ACTIVE' filter
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_tenant_members_for_jobs(
  p_tenant_id    UUID,
  p_department_id UUID DEFAULT NULL
)
RETURNS TABLE (
  user_id        UUID,
  department_id  UUID,
  permission_tier TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = p_tenant_id
          AND tm.user_id   = auth.uid()
          AND tm.active    = true
    ) THEN
        RAISE EXCEPTION 'Access denied: caller is not an active member of this tenant';
    END IF;

    RETURN QUERY
    SELECT tm.user_id, tm.department_id, tm.permission_tier::TEXT
    FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id
      AND tm.active    = true
      AND (p_department_id IS NULL OR tm.department_id = p_department_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_tenant_members_for_jobs(UUID, UUID) TO authenticated;

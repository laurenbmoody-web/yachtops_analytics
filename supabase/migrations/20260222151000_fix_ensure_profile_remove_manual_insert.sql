-- Migration: Fix ensure_profile by removing manual INSERT fallback
-- Created: 2026-02-22 15:10:00
-- Issue: Foreign key constraint violation when ensure_profile tries to INSERT manually
-- Root cause: Manual INSERT fails because auth.users row not yet visible to SECURITY DEFINER function
-- Solution: Remove manual INSERT, rely ONLY on trigger, return error if profile doesn't exist

DROP FUNCTION IF EXISTS public.ensure_profile(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.ensure_profile(
    p_first_name TEXT,
    p_surname TEXT
)
RETURNS TABLE(
    success BOOLEAN,
    profile_id UUID,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_user_email TEXT;
    v_full_name TEXT;
    v_retry_count INT := 0;
    v_max_retries INT := 10;  -- Increased from 5 to 10
    v_profile_exists BOOLEAN;
BEGIN
    -- Get current authenticated user
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false, NULL::UUID, 'Not authenticated'::TEXT;
        RETURN;
    END IF;
    
    -- Wait for auth.users to exist (handle race condition after signup)
    WHILE v_retry_count < v_max_retries LOOP
        SELECT email INTO v_user_email
        FROM auth.users
        WHERE id = v_user_id;
        
        EXIT WHEN v_user_email IS NOT NULL;
        
        -- Wait 200ms before retry
        PERFORM pg_sleep(0.2);
        v_retry_count := v_retry_count + 1;
    END LOOP;
    
    IF v_user_email IS NULL THEN
        RETURN QUERY SELECT false, NULL::UUID, 'User not found in auth system after retries'::TEXT;
        RETURN;
    END IF;
    
    -- Construct full_name
    v_full_name := TRIM(p_first_name || ' ' || p_surname);
    
    -- Wait for trigger to create profile (handle race condition)
    v_retry_count := 0;
    WHILE v_retry_count < v_max_retries LOOP
        SELECT EXISTS(
            SELECT 1 FROM public.profiles WHERE id = v_user_id
        ) INTO v_profile_exists;
        
        EXIT WHEN v_profile_exists;
        
        -- Wait 200ms before retry
        PERFORM pg_sleep(0.2);
        v_retry_count := v_retry_count + 1;
    END LOOP;
    
    -- If profile still doesn't exist after retries, return error
    -- DO NOT try to INSERT manually (causes foreign key violation)
    IF NOT v_profile_exists THEN
        RETURN QUERY SELECT false, NULL::UUID, 'Profile not created by trigger. Please contact support.'::TEXT;
        RETURN;
    END IF;
    
    -- Update profile with first_name and surname
    UPDATE public.profiles
    SET
        first_name = TRIM(p_first_name),
        surname = TRIM(p_surname),
        full_name = v_full_name,
        email = v_user_email,
        updated_at = NOW()
    WHERE id = v_user_id;
    
    -- Return success
    RETURN QUERY SELECT true, v_user_id, NULL::TEXT;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN QUERY SELECT false, NULL::UUID, SQLERRM::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_profile(TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.ensure_profile(TEXT, TEXT) IS 
'Ensures a profile exists for the current user with first_name and surname. '
'Waits for trigger-created profile (up to 2 seconds) then updates it. '
'Returns error if profile not created by trigger. Used during invite acceptance.';
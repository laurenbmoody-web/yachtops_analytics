-- Migration: Fix ensure_profile race condition
-- Created: 2026-02-22
-- Issue: Foreign key constraint violation when ensure_profile runs immediately after signUp
-- Root cause: ensure_profile tries to INSERT into profiles before auth.users row is fully committed

-- Solution: Modify ensure_profile to wait for auth.users to exist and rely on trigger for initial creation

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
    v_max_retries INT := 5;
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
    
    -- If profile still doesn't exist after retries, try to create it
    -- This handles cases where trigger failed
    IF NOT v_profile_exists THEN
        BEGIN
            INSERT INTO public.profiles (
                id,
                email,
                first_name,
                surname,
                full_name,
                created_at,
                updated_at
            )
            VALUES (
                v_user_id,
                v_user_email,
                TRIM(p_first_name),
                TRIM(p_surname),
                v_full_name,
                NOW(),
                NOW()
            );
        EXCEPTION
            WHEN foreign_key_violation THEN
                RETURN QUERY SELECT false, NULL::UUID, 'Auth user not yet available in database'::TEXT;
                RETURN;
            WHEN unique_violation THEN
                -- Profile was created by trigger between check and insert, continue to update
                NULL;
        END;
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
'Includes retry logic to handle race conditions where auth.users or profiles '
'may not be immediately available after signup. Used during invite acceptance.';
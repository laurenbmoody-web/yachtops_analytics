-- Migration: Add ensure_profile RPC to safely create/update profile
-- Created: 2026-02-22
-- Purpose: Ensure profile exists before accepting invite, preventing "User profile not found" errors

-- Drop existing function if it exists (handles return type changes)
DROP FUNCTION IF EXISTS public.ensure_profile(TEXT, TEXT);

-- Create RPC function to ensure profile exists with proper data
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
AS $$
DECLARE
    v_user_id UUID;
    v_user_email TEXT;
    v_full_name TEXT;
BEGIN
    -- Get current authenticated user
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false, NULL::UUID, 'Not authenticated'::TEXT;
        RETURN;
    END IF;
    
    -- Get user email from auth.users
    SELECT email INTO v_user_email
    FROM auth.users
    WHERE id = v_user_id;
    
    IF v_user_email IS NULL THEN
        RETURN QUERY SELECT false, NULL::UUID, 'User email not found in auth system'::TEXT;
        RETURN;
    END IF;
    
    -- Construct full_name
    v_full_name := TRIM(p_first_name || ' ' || p_surname);
    
    -- Upsert profile (insert if not exists, update if exists)
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
    )
    ON CONFLICT (id)
    DO UPDATE SET
        first_name = TRIM(p_first_name),
        surname = TRIM(p_surname),
        full_name = v_full_name,
        email = v_user_email,
        updated_at = NOW();
    
    -- Return success
    RETURN QUERY SELECT true, v_user_id, NULL::TEXT;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN QUERY SELECT false, NULL::UUID, SQLERRM::TEXT;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.ensure_profile(TEXT, TEXT) TO authenticated;

-- Add comment
COMMENT ON FUNCTION public.ensure_profile(TEXT, TEXT) IS 'Ensures a profile exists for the current user with first_name and surname. Used during invite acceptance to prevent profile not found errors.';
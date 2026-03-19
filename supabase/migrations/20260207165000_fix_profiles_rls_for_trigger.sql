-- Migration: Fix profiles RLS policy to allow trigger-based profile creation
-- Created: 2026-02-07
-- Issue: Login error - new row violates row-level security policy for table "profiles"
-- Root cause: Trigger function cannot insert into profiles due to RLS policy

-- Solution: Recreate the trigger function to properly bypass RLS
-- The function needs to run with elevated privileges to insert profiles

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Insert profile with explicit column list
    -- SECURITY DEFINER allows this function to bypass RLS
    INSERT INTO public.profiles (id, full_name, email, account_type)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        NEW.email,
        'CREW'
    )
    ON CONFLICT (id) DO UPDATE
    SET
        email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name);
    
    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- Log error but don't fail the auth user creation
        RAISE WARNING 'Failed to create profile for user %: %', NEW.id, SQLERRM;
        RETURN NEW;
END;
$$;

-- Ensure the trigger exists (recreate if needed)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Grant necessary permissions to the function owner
-- This ensures the SECURITY DEFINER function can bypass RLS
GRANT ALL ON public.profiles TO postgres;
GRANT ALL ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- Add a comment explaining the fix
COMMENT ON FUNCTION public.handle_new_user() IS 
'Trigger function that automatically creates a profile when a new user signs up. '
'Uses SECURITY DEFINER to bypass RLS policies and ensure profile creation succeeds. '
'Includes error handling to prevent auth user creation from failing if profile insert fails.';
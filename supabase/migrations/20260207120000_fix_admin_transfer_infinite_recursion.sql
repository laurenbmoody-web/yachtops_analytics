-- Migration: Fix infinite recursion in admin_transfer RLS policies
-- Purpose: Remove tenant_members queries from admin_transfer_requests and admin_transfer_audit policies
-- Error: "infinite recursion detected in policy for relation tenant_members"
-- Root cause: admin_transfer RLS policies query tenant_members, which has restrictive RLS causing recursion
-- Solution: Use direct user_id checks instead of EXISTS queries on tenant_members

-- Step 1: Drop ALL existing policies on admin_transfer_requests
DROP POLICY IF EXISTS "users_view_transfer_requests" ON public.admin_transfer_requests;
DROP POLICY IF EXISTS "command_create_transfer_request" ON public.admin_transfer_requests;
DROP POLICY IF EXISTS "users_update_transfer_request" ON public.admin_transfer_requests;

-- Step 2: Drop ALL existing policies on admin_transfer_audit
DROP POLICY IF EXISTS "users_view_transfer_audit" ON public.admin_transfer_audit;
DROP POLICY IF EXISTS "command_insert_transfer_audit" ON public.admin_transfer_audit;

-- Step 3: Create new policies for admin_transfer_requests using direct user checks
-- These policies allow users to see transfers where they are involved (from_user or to_user)
-- This avoids querying tenant_members and prevents circular dependency

CREATE POLICY "admin_transfer_requests_select_involved"
ON public.admin_transfer_requests
FOR SELECT
TO authenticated
USING (
    from_user_id = auth.uid() 
    OR to_user_id = auth.uid()
);

CREATE POLICY "admin_transfer_requests_insert_own"
ON public.admin_transfer_requests
FOR INSERT
TO authenticated
WITH CHECK (
    from_user_id = auth.uid()
);

CREATE POLICY "admin_transfer_requests_update_involved"
ON public.admin_transfer_requests
FOR UPDATE
TO authenticated
USING (
    from_user_id = auth.uid() 
    OR to_user_id = auth.uid()
)
WITH CHECK (
    from_user_id = auth.uid() 
    OR to_user_id = auth.uid()
);

-- Step 4: Create new policies for admin_transfer_audit using direct user checks
-- Users can view audit logs where they were involved in the transfer

CREATE POLICY "admin_transfer_audit_select_involved"
ON public.admin_transfer_audit
FOR SELECT
TO authenticated
USING (
    from_user_id = auth.uid() 
    OR to_user_id = auth.uid()
);

CREATE POLICY "admin_transfer_audit_insert_own"
ON public.admin_transfer_audit
FOR INSERT
TO authenticated
WITH CHECK (
    from_user_id = auth.uid() 
    OR to_user_id = auth.uid()
);

-- Note: These simplified policies allow users to:
-- 1. View transfer requests where they are the sender or recipient
-- 2. Create transfer requests as the sender
-- 3. Update transfer requests where they are involved
-- 4. View audit logs where they were involved
-- This removes the need to query tenant_members and prevents infinite recursion
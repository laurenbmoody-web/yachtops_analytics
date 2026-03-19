-- Migration: Add admin transfer tracking and audit log
-- Created: 2026-01-26

-- 1. Create admin_transfer_requests table for pending transfers
CREATE TABLE IF NOT EXISTS public.admin_transfer_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    from_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    to_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'CANCELLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    CONSTRAINT unique_pending_transfer UNIQUE (tenant_id, status)
);

-- 2. Create admin_transfer_audit table for audit log
CREATE TABLE IF NOT EXISTS public.admin_transfer_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    from_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    to_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    transferred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    from_user_name TEXT,
    to_user_name TEXT
);

-- 3. Enable RLS on new tables
ALTER TABLE public.admin_transfer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_transfer_audit ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies for admin_transfer_requests
-- Users can view transfer requests for tenants they belong to
CREATE POLICY "users_view_transfer_requests"
ON public.admin_transfer_requests
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = admin_transfer_requests.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active = true
    )
);

-- COMMAND users can create transfer requests
CREATE POLICY "command_create_transfer_request"
ON public.admin_transfer_requests
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = tenant_id
        AND tm.user_id = auth.uid()
        AND tm.permission_tier = 'COMMAND'
        AND tm.active = true
    )
    AND from_user_id = auth.uid()
);

-- COMMAND users and target users can update transfer requests
CREATE POLICY "users_update_transfer_request"
ON public.admin_transfer_requests
FOR UPDATE
TO authenticated
USING (
    (from_user_id = auth.uid() OR to_user_id = auth.uid())
    AND EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = admin_transfer_requests.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active = true
    )
)
WITH CHECK (
    (from_user_id = auth.uid() OR to_user_id = auth.uid())
    AND EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = admin_transfer_requests.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active = true
    )
);

-- 5. RLS Policies for admin_transfer_audit
-- Users can view audit logs for tenants they belong to
CREATE POLICY "users_view_transfer_audit"
ON public.admin_transfer_audit
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = admin_transfer_audit.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active = true
    )
);

-- COMMAND users can insert audit logs (system operation)
CREATE POLICY "command_insert_transfer_audit"
ON public.admin_transfer_audit
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = tenant_id
        AND tm.user_id = auth.uid()
        AND tm.permission_tier = 'COMMAND'
        AND tm.active = true
    )
);

-- 6. Create indexes for performance
CREATE INDEX idx_admin_transfer_requests_tenant ON public.admin_transfer_requests(tenant_id);
CREATE INDEX idx_admin_transfer_requests_to_user ON public.admin_transfer_requests(to_user_id);
CREATE INDEX idx_admin_transfer_requests_status ON public.admin_transfer_requests(status);
CREATE INDEX idx_admin_transfer_audit_tenant ON public.admin_transfer_audit(tenant_id);
CREATE INDEX idx_admin_transfer_audit_transferred_at ON public.admin_transfer_audit(transferred_at DESC);
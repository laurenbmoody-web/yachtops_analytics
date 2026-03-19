-- Create avatars bucket for profile photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'avatars',
    'avatars',
    false,  -- Private bucket
    2097152, -- 2MB limit
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- RLS: Users can manage their own avatar files
DROP POLICY IF EXISTS "users_manage_own_avatars" ON storage.objects;
CREATE POLICY "users_manage_own_avatars" 
ON storage.objects
FOR ALL 
TO authenticated
USING (
    bucket_id = 'avatars' 
    AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
    bucket_id = 'avatars' 
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- RLS: Users can view avatars of crew in same tenant
DROP POLICY IF EXISTS "users_view_tenant_avatars" ON storage.objects;
CREATE POLICY "users_view_tenant_avatars"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'avatars'
    AND EXISTS (
        SELECT 1 FROM public.tenant_members tm1
        JOIN public.tenant_members tm2 ON tm1.tenant_id = tm2.tenant_id
        WHERE tm1.user_id = auth.uid()
        AND tm2.user_id = (storage.foldername(name))[1]::uuid
        AND tm1.active = true
        AND tm2.active = true
    )
);
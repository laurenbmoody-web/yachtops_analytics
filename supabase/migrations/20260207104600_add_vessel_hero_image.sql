-- Migration: Add vessel hero image storage and fields
-- Purpose: Enable vessels to upload custom hero images for dashboard

-- 1. Create vessel_assets storage bucket (public)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'vessel-assets',
    'vessel-assets',
    true,  -- PUBLIC bucket for hero images
    5242880, -- 5MB limit
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 2. RLS Policies for vessel_assets bucket
-- Anyone can view (public bucket)
DROP POLICY IF EXISTS "public_read_vessel_assets" ON storage.objects;
CREATE POLICY "public_read_vessel_assets" 
ON storage.objects
FOR SELECT 
TO public
USING (bucket_id = 'vessel-assets');

-- COMMAND role can upload for their vessel
DROP POLICY IF EXISTS "command_upload_vessel_assets" ON storage.objects;
CREATE POLICY "command_upload_vessel_assets" 
ON storage.objects
FOR INSERT 
TO authenticated
WITH CHECK (
    bucket_id = 'vessel-assets' AND
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.user_id = auth.uid()
        AND tm.permission_tier = 'COMMAND'
        AND tm.active = true
    )
);

-- COMMAND role can update/delete their vessel's assets
DROP POLICY IF EXISTS "command_manage_vessel_assets" ON storage.objects;
CREATE POLICY "command_manage_vessel_assets" 
ON storage.objects
FOR UPDATE 
TO authenticated
USING (
    bucket_id = 'vessel-assets' AND
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.user_id = auth.uid()
        AND tm.permission_tier = 'COMMAND'
        AND tm.active = true
    )
)
WITH CHECK (
    bucket_id = 'vessel-assets' AND
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.user_id = auth.uid()
        AND tm.permission_tier = 'COMMAND'
        AND tm.active = true
    )
);

DROP POLICY IF EXISTS "command_delete_vessel_assets" ON storage.objects;
CREATE POLICY "command_delete_vessel_assets" 
ON storage.objects
FOR DELETE 
TO authenticated
USING (
    bucket_id = 'vessel-assets' AND
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.user_id = auth.uid()
        AND tm.permission_tier = 'COMMAND'
        AND tm.active = true
    )
);

-- 3. Add hero image fields to vessels table
ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS hero_image_url text,
  ADD COLUMN IF NOT EXISTS use_custom_hero boolean DEFAULT false;

-- 4. Add comments for documentation
COMMENT ON COLUMN public.vessels.hero_image_url IS 'Public URL of custom hero image uploaded to vessel-assets bucket';
COMMENT ON COLUMN public.vessels.use_custom_hero IS 'Whether to display custom hero image (true) or default blueprint (false)';
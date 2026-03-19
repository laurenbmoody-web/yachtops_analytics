-- Add preference_image_url column to guest_preferences table
ALTER TABLE public.guest_preferences
ADD COLUMN IF NOT EXISTS preference_image_url TEXT DEFAULT NULL;

-- Create preference-images storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'preference-images',
  'preference-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for preference-images bucket
DROP POLICY IF EXISTS "preference_images_select" ON storage.objects;
CREATE POLICY "preference_images_select"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'preference-images');

DROP POLICY IF EXISTS "preference_images_insert" ON storage.objects;
CREATE POLICY "preference_images_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'preference-images');

DROP POLICY IF EXISTS "preference_images_update" ON storage.objects;
CREATE POLICY "preference_images_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'preference-images')
WITH CHECK (bucket_id = 'preference-images');

DROP POLICY IF EXISTS "preference_images_delete" ON storage.objects;
CREATE POLICY "preference_images_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'preference-images');

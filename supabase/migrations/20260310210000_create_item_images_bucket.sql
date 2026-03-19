-- Create item-images storage bucket for inventory item photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'item-images',
  'item-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for item-images bucket
DROP POLICY IF EXISTS "item_images_public_read" ON storage.objects;
CREATE POLICY "item_images_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'item-images');

DROP POLICY IF EXISTS "item_images_authenticated_upload" ON storage.objects;
CREATE POLICY "item_images_authenticated_upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'item-images');

DROP POLICY IF EXISTS "item_images_authenticated_update" ON storage.objects;
CREATE POLICY "item_images_authenticated_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'item-images')
WITH CHECK (bucket_id = 'item-images');

DROP POLICY IF EXISTS "item_images_authenticated_delete" ON storage.objects;
CREATE POLICY "item_images_authenticated_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'item-images');

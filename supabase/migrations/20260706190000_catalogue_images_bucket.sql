-- Public bucket for supplier catalogue product images.
-- Same shape as item-images (20260310210000). Path scheme:
--   catalogue-images/{supplier_id}/{catalogue_item_id}.{ext}
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'catalogue-images',
  'catalogue-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "catalogue_images_public_read" ON storage.objects;
CREATE POLICY "catalogue_images_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'catalogue-images');

DROP POLICY IF EXISTS "catalogue_images_authenticated_upload" ON storage.objects;
CREATE POLICY "catalogue_images_authenticated_upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'catalogue-images');

DROP POLICY IF EXISTS "catalogue_images_authenticated_update" ON storage.objects;
CREATE POLICY "catalogue_images_authenticated_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'catalogue-images')
WITH CHECK (bucket_id = 'catalogue-images');

DROP POLICY IF EXISTS "catalogue_images_authenticated_delete" ON storage.objects;
CREATE POLICY "catalogue_images_authenticated_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'catalogue-images');

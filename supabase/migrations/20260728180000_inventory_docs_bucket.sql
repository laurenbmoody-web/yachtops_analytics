-- Public bucket for inventory item documents — the checklist / SOP a
-- maintenance item links to (a PDF the crew upload against the item).
-- Mirrors the item-images bucket (20260310210000): public read, authenticated
-- write. Path scheme: inventory/checklists/<tenant>/<ts>-<name>.pdf
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inventory-docs',
  'inventory-docs',
  true,
  10485760,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for inventory-docs bucket
DROP POLICY IF EXISTS "inventory_docs_public_read" ON storage.objects;
CREATE POLICY "inventory_docs_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'inventory-docs');

DROP POLICY IF EXISTS "inventory_docs_authenticated_upload" ON storage.objects;
CREATE POLICY "inventory_docs_authenticated_upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'inventory-docs');

DROP POLICY IF EXISTS "inventory_docs_authenticated_update" ON storage.objects;
CREATE POLICY "inventory_docs_authenticated_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'inventory-docs')
WITH CHECK (bucket_id = 'inventory-docs');

DROP POLICY IF EXISTS "inventory_docs_authenticated_delete" ON storage.objects;
CREATE POLICY "inventory_docs_authenticated_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'inventory-docs');

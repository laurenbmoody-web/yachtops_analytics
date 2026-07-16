-- Photo (and docket/invoice) attachments in supplier↔yacht chat.
--
-- A public bucket (unguessable per-thread UUID paths) both sides can read, plus
-- an attachments jsonb array on the message — each entry {url, name, type, size}.
-- Same shape as the catalogue-images bucket (20260706190000).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'message-attachments',
  'message-attachments',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "message_attachments_public_read" ON storage.objects;
CREATE POLICY "message_attachments_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'message-attachments');

DROP POLICY IF EXISTS "message_attachments_authenticated_upload" ON storage.objects;
CREATE POLICY "message_attachments_authenticated_upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'message-attachments');

DROP POLICY IF EXISTS "message_attachments_authenticated_delete" ON storage.objects;
CREATE POLICY "message_attachments_authenticated_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'message-attachments');

ALTER TABLE public.supplier_messages
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

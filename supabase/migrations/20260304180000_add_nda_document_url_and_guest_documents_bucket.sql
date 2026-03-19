-- Migration: Add NDA document URL to guests + create guest-documents storage bucket
-- Timestamp: 20260304180000

-- 1. Add nda_document_url column to guests table
ALTER TABLE public.guests
ADD COLUMN IF NOT EXISTS nda_document_url TEXT;

-- 2. Create guest-documents private bucket (skip if already exists)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'guest-documents',
  'guest-documents',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- 3. RLS policies for guest-documents bucket
-- Authenticated users who are tenant members can upload/read/delete guest documents
DROP POLICY IF EXISTS "tenant_members_select_guest_documents" ON storage.objects;
CREATE POLICY "tenant_members_select_guest_documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'guest-documents');

DROP POLICY IF EXISTS "tenant_members_insert_guest_documents" ON storage.objects;
CREATE POLICY "tenant_members_insert_guest_documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'guest-documents');

DROP POLICY IF EXISTS "tenant_members_update_guest_documents" ON storage.objects;
CREATE POLICY "tenant_members_update_guest_documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'guest-documents')
WITH CHECK (bucket_id = 'guest-documents');

DROP POLICY IF EXISTS "tenant_members_delete_guest_documents" ON storage.objects;
CREATE POLICY "tenant_members_delete_guest_documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'guest-documents');

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260713170000_vessel_docs_source.sql
--
-- WHAT: Provenance for vault files copied from a crew member's personal record.
--       source_document_id points back at the personal_documents row a vault
--       file was synced from. Used to (a) dedupe the "Sync crew certificates"
--       action so a refresh only pulls NEW docs, and (b) give an audit trail of
--       where a vault file originated.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.vessel_documents
  ADD COLUMN IF NOT EXISTS source_document_id uuid;

CREATE INDEX IF NOT EXISTS vessel_documents_source_idx
  ON public.vessel_documents (tenant_id, source_document_id)
  WHERE source_document_id IS NOT NULL;

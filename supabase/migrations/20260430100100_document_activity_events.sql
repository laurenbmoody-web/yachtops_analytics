-- Sprint 9b — Document activity events (documentation-only)
--
-- This migration documents the new event_type values that the document and
-- signing edge functions will write into supplier_order_activity. No schema
-- changes — the activity table accepts arbitrary text event types — but
-- centralising the contract here means future readers can grep for it.
--
--   'order_pdf_generated'
--      payload: { url, generated_by_role: 'supplier'|'vessel'|'system' }
--      written by: generateOrderPdf edge function
--
--   'delivery_note_generated'
--      payload: { url, signing_token_minted: true }
--      written by: generateDeliveryNote edge function
--      (the token itself is NOT stored in the activity payload — only on
--       supplier_orders — to keep activity payloads safe to expose)
--
--   'delivery_note_signed'
--      payload: { signer_name, has_discrepancy_notes, signed_pdf_url }
--      actor_role: 'vessel'  (the signer is anon; we tag the role from URL)
--      written by: signDeliveryNote edge function
--
--   'delivery_emails_sent'
--      payload: { to: [emails], document_kinds: ['signed_delivery_note'] }
--      written by: sendDeliveryNoteEmails edge function
--
-- Defensive guard: if supplier_order_activity does not yet exist, skip
-- silently. Production has it (Sprint 7), but this keeps fresh local clones
-- consistent.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'supplier_order_activity'
  ) THEN
    RAISE NOTICE 'supplier_order_activity not present — document event types will land when activity log is created.';
    RETURN;
  END IF;

  -- No-op DDL: the table accepts free-text event_type. This block exists
  -- to make the migration meaningful as a documentation anchor.
  PERFORM 1;
END $$;

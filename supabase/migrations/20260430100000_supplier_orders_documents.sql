-- Sprint 9b — Cargo-branded documents: Order PDF + Delivery Note + signing
--
-- Adds document storage references and signature capture columns to
-- supplier_orders. Two distinct document tracks:
--
--  1. Order PDF — Cargo-branded order acknowledgement, generated on demand
--     (or on first status advance). Mirrors the supplier invoice flow but
--     uses Cargo branding rather than supplier branding.
--
--  2. Delivery Note PDF — generated when supplier marks the order ready for
--     delivery. Contains a public capability URL (delivery_signing_token)
--     embedded as a QR code so the receiving crew can sign on their phone.
--     Once signed, the signed-PDF version is regenerated and stored
--     separately so the original unsigned note remains auditable.
--
-- All PDF URLs point at private storage objects in the supplier-documents
-- bucket; consumers mint short-lived signed URLs via the
-- getDocumentSignedUrl edge function.

ALTER TABLE public.supplier_orders
  ADD COLUMN IF NOT EXISTS order_pdf_url                text,
  ADD COLUMN IF NOT EXISTS order_pdf_generated_at       timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_note_pdf_url        text,
  ADD COLUMN IF NOT EXISTS delivery_note_generated_at   timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_note_signed_pdf_url text,
  ADD COLUMN IF NOT EXISTS delivery_signing_token       text,
  ADD COLUMN IF NOT EXISTS delivered_signed_at          timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_signature          jsonb,
  ADD COLUMN IF NOT EXISTS delivered_signer_name        text,
  ADD COLUMN IF NOT EXISTS delivery_discrepancy_notes   text;

-- Unique partial index on the signing token. Tokens are 32-char random
-- strings minted at delivery-note generation time; absence is the default,
-- so partial-on-NOT-NULL keeps the constraint cheap.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_orders_delivery_signing_token_idx
  ON public.supplier_orders(delivery_signing_token)
  WHERE delivery_signing_token IS NOT NULL;

COMMENT ON COLUMN public.supplier_orders.order_pdf_url IS
  'Storage path (supplier-documents bucket) for the Cargo-branded order acknowledgement PDF. Access via getDocumentSignedUrl edge function.';

COMMENT ON COLUMN public.supplier_orders.order_pdf_generated_at IS
  'Timestamp the order PDF was last (re)generated. NULL if not yet generated.';

COMMENT ON COLUMN public.supplier_orders.delivery_note_pdf_url IS
  'Storage path for the unsigned delivery note PDF. Contains the QR code linking to the public signing page. Preserved after signing for audit.';

COMMENT ON COLUMN public.supplier_orders.delivery_note_generated_at IS
  'Timestamp the (unsigned) delivery note was generated. Once set, delivery_signing_token is also set.';

COMMENT ON COLUMN public.supplier_orders.delivery_note_signed_pdf_url IS
  'Storage path for the signed delivery note PDF. Generated after the receiving crew signs via the public capability URL.';

COMMENT ON COLUMN public.supplier_orders.delivery_signing_token IS
  '32-char random capability token. URL: /delivery-sign/<token>. Public anon access via SECURITY DEFINER RPC fetch_order_for_delivery_signing(token).';

COMMENT ON COLUMN public.supplier_orders.delivered_signed_at IS
  'Timestamp the signature was captured. Set by signDeliveryNote edge function.';

COMMENT ON COLUMN public.supplier_orders.delivered_signature IS
  'JSONB envelope: {data_url, ip, user_agent, signed_at}. data_url is a base64-encoded PNG from the signature canvas.';

COMMENT ON COLUMN public.supplier_orders.delivered_signer_name IS
  'Printed name typed by the signer alongside the canvas signature.';

COMMENT ON COLUMN public.supplier_orders.delivery_discrepancy_notes IS
  'Optional free-text discrepancy log captured at signing time (short-delivery, damage, substitutions noted by crew).';

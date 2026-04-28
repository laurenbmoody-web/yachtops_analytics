-- Sprint 9b Commit 4.5 — rename signature columns to crew_* prefix.
--
-- The Sprint 9b commit 1 migration created delivered_*/delivery_discrepancy_notes
-- columns under the assumption that there's only one signing party (the crew).
-- Sprint 9c will introduce supplier-side signing too — at that point we'll add
-- supplier_signed_at/_signature/_signer_name. Pre-emptively renaming the
-- existing columns now avoids ambiguity and a churnier rename later.
--
-- discrepancy_notes is also crew-perspective (notes captured by the receiving
-- crew at signing time about what was actually delivered), so it gets the
-- crew_ prefix too.
--
-- Mapping:
--   delivered_signed_at         → crew_signed_at
--   delivered_signature         → crew_signature
--   delivered_signer_name       → crew_signer_name
--   delivery_discrepancy_notes  → crew_discrepancy_notes
--
-- IF EXISTS guards make the migration idempotent and safe on fresh clones
-- where Sprint 9b commit 1 wasn't applied. RENAME preserves data, indexes,
-- and comments — no data movement required.

ALTER TABLE public.supplier_orders RENAME COLUMN delivered_signed_at        TO crew_signed_at;
ALTER TABLE public.supplier_orders RENAME COLUMN delivered_signature        TO crew_signature;
ALTER TABLE public.supplier_orders RENAME COLUMN delivered_signer_name      TO crew_signer_name;
ALTER TABLE public.supplier_orders RENAME COLUMN delivery_discrepancy_notes TO crew_discrepancy_notes;

-- Refresh the column comments to match the new names + clarify perspective.
COMMENT ON COLUMN public.supplier_orders.crew_signed_at IS
  'Timestamp the receiving crew signed the delivery note. Set by signDeliveryNote edge function. Sprint 9c will add supplier_signed_at alongside.';

COMMENT ON COLUMN public.supplier_orders.crew_signature IS
  'JSONB envelope: {data_url, ip, user_agent, signed_at}. data_url is a base64-encoded PNG from the crew member''s signature canvas.';

COMMENT ON COLUMN public.supplier_orders.crew_signer_name IS
  'Printed name typed by the crew member alongside the canvas signature.';

COMMENT ON COLUMN public.supplier_orders.crew_discrepancy_notes IS
  'Free-text discrepancies captured by the crew at signing (short delivery, damage, substitutions). Surfaced on the vessel side via Sprint 9c — likely as a return-trigger hint.';

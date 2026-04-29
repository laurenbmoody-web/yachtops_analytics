-- Sprint 9b Commit 7 Run 1 — delivery_note_emailed_at stamp
--
-- Tracks the most recent timestamp the unsigned delivery note signing
-- link was emailed. Used by sendDeliveryNoteEmails for idempotency:
-- refuses sends within 30 minutes of the last unless { force: true }
-- is passed (catches double-clicks; legitimate resends use force).
--
-- Lives as a column on supplier_orders alongside the other delivery-
-- note timestamps (delivery_note_generated_at, crew_signed_at, etc.).
-- Pattern matches the existing schema — no separate delivery_notes
-- entity needed for v1.

ALTER TABLE public.supplier_orders
  ADD COLUMN IF NOT EXISTS delivery_note_emailed_at timestamptz;

COMMENT ON COLUMN public.supplier_orders.delivery_note_emailed_at IS
  'Most recent timestamp the unsigned delivery note signing link was emailed via sendDeliveryNoteEmails. NULL if never sent. Idempotency guard: function refuses sends within 30 minutes of this stamp unless force=true is passed.';

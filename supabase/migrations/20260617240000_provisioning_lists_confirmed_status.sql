-- ─────────────────────────────────────────────────────────────────────────────
-- 20260617240000_provisioning_lists_confirmed_status.sql
--
-- Extends provisioning_lists.status CHECK constraint to include the
-- 'confirmed' and 'partially_confirmed' values the quote-approval
-- flow writes (#1169, #1178). Without this widening, the
-- approveAllQuotes() helper would call .update({ status: 'confirmed'})
-- and Postgres would silently bounce the row (constraint violation
-- without raising back through the supabase-js wrapper). The board
-- chip stayed at QUOTE IN even though the per-line accepts landed.
--
-- Mirrors the existing supplier_orders.status check which already
-- carried both values (see 20260417300000_supplier_orders.sql).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.provisioning_lists
  DROP CONSTRAINT IF EXISTS provisioning_lists_status_check;

ALTER TABLE public.provisioning_lists
  ADD CONSTRAINT provisioning_lists_status_check
  CHECK (status IN (
    'draft',
    'pending_approval',
    'quote_received',
    'sent_to_supplier',
    'confirmed',
    'partially_confirmed',
    'partially_delivered',
    'delivered_with_discrepancies',
    'delivered'
  ));

COMMENT ON CONSTRAINT provisioning_lists_status_check
  ON public.provisioning_lists IS
  'Board lifecycle. quote_received (supplier returned a quote) flips
   straight to confirmed (or partially_confirmed if a multi-supplier
   board has only some quotes ready) when the approver / chief
   approves the quote — no intermediate quote_approved label.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260701120000_provisioning_items_unavailable_status.sql
--
-- Adds 'unavailable' to the provisioning_items.status CHECK enum so the
-- crew can mark a board line as won't-be-supplied on manual / unassigned
-- items (a supplier who can't provide it, or an item the vessel decides
-- not to order). Without a board-level 'unavailable', a manual multi-
-- supplier board could sit at 'partially_confirmed' forever — the confirm
-- rollup counts every item, so an item that will never be quoted blocks
-- the board from ever reaching 'confirmed'. Marking it unavailable takes
-- it out of the "waiting on a quote" count while keeping the record
-- (better than deleting for month-end / audit).
--
-- This mirrors the supplier-side value: supplier_order_items.status has
-- carried 'unavailable' since 20260417300000 (the supplier marking a line
-- they can't fulfil). This is the crew-side equivalent for lines that
-- aren't on a portal supplier's order.
--
-- Prior enum (20260610130000_provisioning_items_returns.sql):
--   draft, ordered, received, partial, not_received, returned
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.provisioning_items
  DROP CONSTRAINT IF EXISTS provisioning_items_status_check;

ALTER TABLE public.provisioning_items
  ADD CONSTRAINT provisioning_items_status_check
  CHECK (status IN (
    'draft',
    'ordered',
    'received',
    'partial',
    'not_received',
    'returned',
    'unavailable'
  ));

COMMENT ON CONSTRAINT provisioning_items_status_check
  ON public.provisioning_items IS
  'Board line lifecycle. ''unavailable'' is a crew-set decision that this
   line won''t be supplied (manual / unassigned lines only — portal-
   supplier lines take their status from the supplier). Counts as settled
   in the quote-confirm rollup and is excluded from cost totals and the
   Send-to-Supplier flow.';

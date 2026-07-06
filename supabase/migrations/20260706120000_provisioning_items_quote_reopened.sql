-- ─────────────────────────────────────────────────────────────────────────────
-- 20260706120000_provisioning_items_quote_reopened.sql
--
-- Adds provisioning_items.quote_reopened — the manual-quote equivalent of
-- reopening a supplier-confirmed line.
--
-- On a confirmed / partially-confirmed board a line carrying an applied
-- quote price (quoted_unit_cost) reads as "quote-confirmed" and locks
-- (read-only, excluded from re-send). Supplier-portal lines can be
-- reopened via reopenOrderItem(); manual lines had no such lever. This
-- flag is that lever: setting it true reopens the line for edits / re-send
-- WITHOUT discarding the entered price, so the crew doesn't have to
-- re-quote from scratch. The next board confirm clears it (re-locks the
-- line), mirroring how a supplier re-confirm closes a reopened order line.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.provisioning_items
  ADD COLUMN IF NOT EXISTS quote_reopened boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.provisioning_items.quote_reopened IS
  'True when a quote-confirmed manual line has been reopened for changes.
   While true the line is unlocked (editable, re-sendable) and no longer
   counts as confirmed in the board rollup, even though quoted_unit_cost is
   retained. Cleared on the next board confirm.';

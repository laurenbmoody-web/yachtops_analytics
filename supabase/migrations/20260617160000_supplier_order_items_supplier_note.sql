-- ─────────────────────────────────────────────────────────────────────────────
-- 20260617160000_supplier_order_items_supplier_note.sql
--
-- Adds supplier_item_note column on supplier_order_items so the supplier
-- can leave a note to the vessel per line without clobbering the
-- vessel-set `notes` field (which carries the chief's original context
-- and is displayed muted under the item name).
--
-- The supplier portal's per-line "+ Note to vessel" expand writes here;
-- the order-level message-to-vessel reuses supplier_orders.supplier_notes
-- which already exists.
--
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.supplier_order_items
  ADD COLUMN IF NOT EXISTS supplier_item_note text;

COMMENT ON COLUMN public.supplier_order_items.supplier_item_note IS
  'Supplier-authored note to the vessel for this specific line. Distinct
   from notes (vessel-authored context at send time) and
   substitute_description (only set when status=substituted).';

-- supplier_orders.list_id — drop NOT NULL + change FK from CASCADE to SET NULL
--
-- Original FK (20260417300000):
--   list_id uuid NOT NULL REFERENCES provisioning_lists(id) ON DELETE CASCADE
--
-- That's wrong on data-integrity grounds. Orders are business artifacts:
-- they were sent to a supplier (potentially via the sendSupplierOrder edge
-- function), may have linked supplier_order_items / supplier_invoices /
-- supplier_deliveries / supplier_return_tasks. They exist independently
-- of the board lifecycle.
--
-- Deleting a board today cascades its orders to oblivion — loses business
-- history forever AND breaks downstream features (Past Orders in the
-- wizard / Quick Add, Favourites, supplier metrics, return tasks losing
-- their order_id link).
--
-- Fix: orders survive board deletion. list_id becomes nullable; FK
-- switches to ON DELETE SET NULL so the order row stays with list_id
-- cleared. Existing code paths that read orders by list_id (board-detail
-- fetchSupplierOrders, cascadeListAndOrderStatusAfterReceive) continue
-- to work — they query with .eq('list_id', listId) which naturally
-- excludes orphans (correct: orphans have no board context).
--
-- Past Orders Quick Add RPC and Favourites RPC both query supplier_orders
-- directly without a list_id filter — orphaned orders will surface in
-- those panels automatically once preserved.
--
-- Other tables with list_id → provisioning_lists CASCADE were audited
-- and are correct as-is (provisioning_items, provisioning_deliveries,
-- list_shares, list_collaborators all genuinely belong to the list).
-- Only supplier_orders has the wrong semantic.
--
-- Idempotent: constraint drop uses IF EXISTS; DROP NOT NULL is no-op
-- if already nullable; ADD CONSTRAINT will fail loudly if a same-name
-- FK already exists, which is fine — the migration shouldn't be
-- re-run on a healthy schema.

ALTER TABLE public.supplier_orders
  DROP CONSTRAINT IF EXISTS supplier_orders_list_id_fkey;

ALTER TABLE public.supplier_orders
  ALTER COLUMN list_id DROP NOT NULL;

ALTER TABLE public.supplier_orders
  ADD CONSTRAINT supplier_orders_list_id_fkey
    FOREIGN KEY (list_id) REFERENCES public.provisioning_lists(id) ON DELETE SET NULL;

-- Phase 3 commit 2 — partial returns infrastructure on provisioning_items
--
-- Adds two things:
--   1. returns_qty numeric column (default 0) — anchors per-item return
--      quantity. Supports partial returns: an item received in qty 5 can
--      have returns_qty = 2 (kept 3, returned 2).
--   2. `returned` value added to the status CHECK enum — set when a full
--      return is processed (returns_qty >= quantity_received). Partial
--      returns are derived at display time from (returns_qty, quantity_
--      received) — no separate enum value needed since the display layer
--      can express "partially returned" without a DB column flip.
--
-- What this commit DOESN'T build: the return-creation UI itself. That's a
-- separate feature workstream. This migration only lays the schema so the
-- derive function (Phase 3 commit 3) can read returns_qty and surface
-- "returned" / "partially returned" on the unified pill. When the return
-- flow is built, its write path can set returns_qty + status accordingly.
--
-- CHECK constraint on returns_qty: >= 0 AND <= quantity_received. Prevents
-- impossible values (negative, or returns exceeding what was received).
-- COALESCE handles the "not yet received" case where quantity_received is
-- null — forces returns_qty to 0 until something is received.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; CHECK constraint drop+add is safe.

ALTER TABLE public.provisioning_items
  ADD COLUMN IF NOT EXISTS returns_qty numeric NOT NULL DEFAULT 0;

ALTER TABLE public.provisioning_items
  DROP CONSTRAINT IF EXISTS provisioning_items_returns_qty_check;

ALTER TABLE public.provisioning_items
  ADD CONSTRAINT provisioning_items_returns_qty_check
  CHECK (returns_qty >= 0 AND returns_qty <= COALESCE(quantity_received, 0));

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
    'returned'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260720130000_uniform_inventory_link.sql
--
-- WHAT: Wire the crew Issued-Kit register to master inventory so uniform is
--       inventory-backed. Inventory is the single source of stock + value;
--       the wardrobe "Crew" folder issues *from* it, the crew profile shows a
--       read-only receipt. Two additions:
--
--         1. inventory_items.is_uniform — flags a stock item as issuable crew
--            uniform, mirroring the existing is_alcohol cross-cutting flag. The
--            wardrobe Crew folder's "Add from inventory" picker filters on it.
--
--         2. crew_issued_kit.inventory_item_id — links an issued row back to the
--            inventory item it was drawn from, so name/value come from inventory
--            (no re-keying — today `value` is hand-typed) and issue/return can
--            move stock. Nullable + ON DELETE SET NULL: deleting the stock item
--            leaves the issued row's text snapshot intact, just unlinked.
--
-- IDEMPOTENCY: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.inventory_items
  add column if not exists is_uniform boolean not null default false;

-- Partial index — the uniform picker only ever queries the flagged rows.
create index if not exists idx_inventory_items_uniform
  on public.inventory_items (tenant_id)
  where is_uniform = true;

alter table public.crew_issued_kit
  add column if not exists inventory_item_id uuid
  references public.inventory_items(id) on delete set null;

create index if not exists crew_issued_kit_inventory_idx
  on public.crew_issued_kit (inventory_item_id);

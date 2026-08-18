-- Make cargo_item_id unique PER TENANT, not globally.
--
-- cargo_item_id is a per-vessel human item number (CARGO-000001, CARGO-000002, …)
-- minted by the trigger assign_cargo_item_id(), which numbers PER TENANT: it takes
-- the tenant's current max CARGO-###### and adds one. But the unique index
-- idx_inventory_items_cargo_item_id was GLOBAL across every tenant, so two vessels
-- both generating CARGO-000001, CARGO-000002, … collided. Once another tenant's
-- sequence overlapped this one, every insert whose minted candidate was already
-- taken globally failed with:
--   duplicate key value violates unique constraint "idx_inventory_items_cargo_item_id"
-- silently breaking item creation (add, photo-scan save, duplicate) for the tenant
-- with the lower max.
--
-- Fix: enforce uniqueness on (tenant_id, cargo_item_id) to match how the code is
-- minted. Global uniqueness implies per-tenant uniqueness, so existing rows already
-- satisfy the new index — no data change or conflict is possible.

drop index if exists public.idx_inventory_items_cargo_item_id;

create unique index if not exists idx_inventory_items_cargo_item_id
  on public.inventory_items (tenant_id, cargo_item_id)
  where cargo_item_id is not null;

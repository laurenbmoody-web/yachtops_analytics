-- ─────────────────────────────────────────────────────────────────────────────
-- Catalogue Phase 1 — product master foundations
--
-- 1. Upgrade supplier_catalogue_items from a flat price list into a real
--    product record: barcode (EAN/GTIN), image, structured pack semantics,
--    numeric stock, active flag.
-- 2. Add catalogue_item_id FKs across the transactional path so order /
--    provisioning / inventory / delivery-inbox lines can carry a stable
--    product identity (consumed by the shop + scan-to-pick in later phases).
-- 3. Add inventory_movements: an append-only stock ledger. inventory_items
--    only stores current state (stock_locations jsonb + total_qty); this
--    table records every change so stock history is auditable.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. supplier_catalogue_items → product record ────────────────────────────

alter table public.supplier_catalogue_items
  add column if not exists barcode    text,
  add column if not exists image_url  text,
  add column if not exists pack_size  numeric(10,2),  -- inner units per sell unit (e.g. 24)
  add column if not exists pack_unit  text,           -- what the inner unit is (e.g. 'bottle')
  add column if not exists unit_size  text,           -- size of one inner unit (e.g. '330ml')
  add column if not exists stock_qty  numeric(12,2),  -- null = not tracked (in_stock bool remains the coarse flag)
  add column if not exists active     boolean not null default true;

-- Barcode / SKU lookup paths for scan-to-pick and import dedupe.
-- Non-unique: the same EAN can legitimately appear on multiple rows
-- (pack variants) until suppliers clean their data.
create index if not exists supplier_catalogue_barcode_idx
  on public.supplier_catalogue_items (supplier_id, barcode)
  where barcode is not null;

create index if not exists supplier_catalogue_sku_idx
  on public.supplier_catalogue_items (supplier_id, sku)
  where sku is not null;

-- ── 2. catalogue_item_id across the transactional path ─────────────────────
-- on delete set null everywhere: deleting a catalogue row must never take
-- historical order / inventory lines with it.

alter table public.provisioning_items
  add column if not exists catalogue_item_id uuid
    references public.supplier_catalogue_items(id) on delete set null;

alter table public.supplier_order_items
  add column if not exists catalogue_item_id uuid
    references public.supplier_catalogue_items(id) on delete set null;

alter table public.inventory_items
  add column if not exists catalogue_item_id uuid
    references public.supplier_catalogue_items(id) on delete set null;

alter table public.delivery_inbox
  add column if not exists catalogue_item_id uuid
    references public.supplier_catalogue_items(id) on delete set null;

create index if not exists provisioning_items_catalogue_idx
  on public.provisioning_items (catalogue_item_id)
  where catalogue_item_id is not null;

create index if not exists supplier_order_items_catalogue_idx
  on public.supplier_order_items (catalogue_item_id)
  where catalogue_item_id is not null;

create index if not exists inventory_items_catalogue_idx
  on public.inventory_items (catalogue_item_id)
  where catalogue_item_id is not null;

create index if not exists delivery_inbox_catalogue_idx
  on public.delivery_inbox (catalogue_item_id)
  where catalogue_item_id is not null;

-- ── 3. inventory_movements — append-only stock ledger ──────────────────────

create table if not exists public.inventory_movements (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  inventory_item_id     uuid not null references public.inventory_items(id) on delete cascade,
  -- Where the stock moved. Matches the loose shape of
  -- inventory_items.stock_locations (locationId is often '' there),
  -- so location_name is the reliable field and location_id is optional.
  location_id           uuid,
  location_name         text,
  qty_delta             numeric(12,2) not null,   -- positive = in, negative = out
  reason                text not null
                          check (reason in ('received','consumed','adjusted','returned','transfer','initial')),
  -- Provenance (all optional — a movement can exist without provisioning)
  provisioning_item_id  uuid references public.provisioning_items(id) on delete set null,
  list_id               uuid references public.provisioning_lists(id) on delete set null,
  catalogue_item_id     uuid references public.supplier_catalogue_items(id) on delete set null,
  notes                 text,
  created_by            uuid default auth.uid() references auth.users(id) on delete set null,
  created_at            timestamptz not null default now()
);

create index if not exists inventory_movements_item_idx
  on public.inventory_movements (inventory_item_id, created_at desc);

create index if not exists inventory_movements_tenant_idx
  on public.inventory_movements (tenant_id, created_at desc);

alter table public.inventory_movements enable row level security;

-- Tenant members read + append. No update/delete policies: the ledger is
-- append-only — corrections are new rows with reason 'adjusted'.
create policy "crew_read_inventory_movements" on public.inventory_movements
  for select using (
    tenant_id in (
      select tenant_id from public.tenant_members
      where user_id = auth.uid() and active = true
    )
  );

create policy "crew_insert_inventory_movements" on public.inventory_movements
  for insert with check (
    tenant_id in (
      select tenant_id from public.tenant_members
      where user_id = auth.uid() and active = true
    )
  );

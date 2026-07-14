-- Safety re-assertion of the per-order messaging thread schema.
--
-- The apply-migrations pipeline was briefly jammed by a duplicate 20260714120000
-- version (two files shared it), which held up 20260714150000. That collision is
-- now resolved, but this guard makes the messaging schema self-healing: every
-- statement is idempotent, so re-running it is a no-op if 150000 already applied,
-- and it guarantees the columns/indexes exist otherwise. Purely defensive — no
-- behavioural change.

-- One thread per order …
create unique index if not exists uq_smt_supplier_order
  on public.supplier_message_threads (supplier_id, tenant_id, order_id)
  where order_id is not null;

-- … and one general (order-less) thread per vessel.
create unique index if not exists uq_smt_supplier_general
  on public.supplier_message_threads (supplier_id, tenant_id)
  where order_id is null;

-- The old single-thread-per-vessel constraint must be gone for per-order threads.
alter table public.supplier_message_threads
  drop constraint if exists supplier_message_threads_supplier_id_tenant_id_key;

-- Archive close-out column.
alter table public.supplier_message_threads
  add column if not exists archived_at timestamptz;

-- Messaging: per-order threads + archive close-out.
--
-- The inbox is a command list — each vessel groups its conversations: one per
-- order, plus a general (order-less) thread. That needs more than a single
-- thread per (supplier, vessel), so the old uniqueness is relaxed to:
--   • at most one thread per order, and
--   • at most one general (order-less) thread per vessel.
-- Archiving is the close-out — swipe a row to archive it. A thread auto-reopens
-- the moment anyone writes in it again, so nothing stays buried.

alter table public.supplier_message_threads
  drop constraint if exists supplier_message_threads_supplier_id_tenant_id_key;

-- One thread per order …
create unique index if not exists uq_smt_supplier_order
  on public.supplier_message_threads (supplier_id, tenant_id, order_id)
  where order_id is not null;

-- … and one general (order-less) thread per vessel.
create unique index if not exists uq_smt_supplier_general
  on public.supplier_message_threads (supplier_id, tenant_id)
  where order_id is null;

alter table public.supplier_message_threads
  add column if not exists archived_at timestamptz;

-- Extend the touch trigger: any new message clears the archive (auto-reopen).
create or replace function public.touch_message_thread()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.supplier_message_threads
     set last_message_at = new.created_at,
         last_message_preview = left(new.body, 140),
         last_sender_type = new.sender_type,
         archived_at = null,
         supplier_unread_count = supplier_unread_count + case when new.sender_type = 'vessel' then 1 else 0 end,
         vessel_unread_count   = vessel_unread_count   + case when new.sender_type = 'supplier' then 1 else 0 end
   where id = new.thread_id;
  return new;
end $$;

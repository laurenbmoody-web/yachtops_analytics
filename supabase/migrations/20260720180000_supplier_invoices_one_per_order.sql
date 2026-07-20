-- One invoice per order.
--
-- Regenerating an invoice replaces the order's existing one in place (see the
-- generateSupplierInvoice edge function) — same invoice number, row updated,
-- PDF overwritten — so the outstanding total isn't double-counted. This unique
-- index is the DB-level guarantee: a double-click / race can't insert a second
-- invoice row for the same order. Partial on (order_id is not null) so any
-- future order-less invoices aren't constrained.
create unique index if not exists supplier_invoices_unique_order
  on public.supplier_invoices (order_id)
  where order_id is not null;

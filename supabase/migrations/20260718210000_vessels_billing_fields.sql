-- ─────────────────────────────────────────────────────────────────────────────
-- 20260718210000_vessels_billing_fields.sql
--
-- Buyer / bill-to invoicing details on the vessel record, so a supplier invoice
-- can print a proper BILL TO block. Entered by the vessel's Command tier in
-- Vessel Settings → Invoicing; pulled by generateSupplierInvoice via the
-- order's tenant_id → vessels (vessels is keyed by tenant_id).
--
-- Lives on `vessels` (not `tenants`) because that's the table the Vessel
-- Settings UI reads/writes and where the other vessel-identity fields live.
-- Inherits the existing vessels RLS (SELECT: tenant members; UPDATE: COMMAND).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.vessels
  add column if not exists billing_legal_name text,
  add column if not exists billing_address    text,
  add column if not exists billing_vat_number text,
  add column if not exists billing_reg_number text,
  add column if not exists billing_email      text;

comment on column public.vessels.billing_legal_name is
  'Legal entity the invoice is billed to (owning/management company). Falls back to the vessel name on the invoice when blank.';
comment on column public.vessels.billing_vat_number is
  'Buyer VAT / tax number, printed in the invoice BILL TO block.';

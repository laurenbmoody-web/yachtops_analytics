-- Supplier VAT-registration flag.
--
-- Lets a supplier declare they are NOT registered for VAT/TVA so the invoice
-- flow stops nagging them for a number they'll never have. Defaults to true
-- (assume registered) so existing suppliers keep the current behaviour — the
-- missing-number prompt still shows until they either add a number or flip
-- this off.
alter table public.supplier_profiles
  add column if not exists vat_registered boolean not null default true;

comment on column public.supplier_profiles.vat_registered is
  'Whether the supplier is registered for VAT/TVA. When false, invoicing skips the missing-VAT-number prompt.';

-- Force PostgREST to refresh its schema cache.
--
-- 20260720120000 added supplier_profiles.vat_registered, but PostgREST's
-- schema cache did not pick the new column up, so every settings save (the
-- payload includes vat_registered) was rejected atomically with
-- "column not found in the schema cache" — nothing persisted, not the toggle
-- nor the VAT number alongside it.
--
-- Re-assert the column (idempotent) and notify PostgREST to reload so the REST
-- API exposes it.
alter table public.supplier_profiles
  add column if not exists vat_registered boolean not null default true;

notify pgrst, 'reload schema';

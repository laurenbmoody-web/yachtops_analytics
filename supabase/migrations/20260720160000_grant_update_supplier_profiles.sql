-- Restore UPDATE on supplier_profiles to the authenticated role.
--
-- The `authenticated` role was missing the table-level UPDATE grant on
-- supplier_profiles (anon and service_role had it — a broken asymmetry, not
-- from any migration here), so every supplier settings save (Tax & invoicing,
-- storefront, etc.) failed at the DB with "permission denied for table
-- supplier_profiles" — a 403 before RLS was even evaluated. The
-- supplier_update_own_profile RLS policy already scopes updates to a
-- supplier's own row, so this grant simply lets that policy do its job.
--
-- Idempotent: GRANT is a no-op if already present.
grant update on public.supplier_profiles to authenticated;

notify pgrst, 'reload schema';

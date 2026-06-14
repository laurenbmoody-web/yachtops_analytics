-- ============================================================
-- provisioning_items.supplier_profile_id
-- Sprint 9c.3 Phase 8 (Batch 2, Commit 1)
-- ============================================================
--
-- Adds a structured item→supplier link. Until now the only
-- item-level supplier signal was the free-text
-- provisioning_items.supplier_name (a typing hint, never used for
-- order routing). Batch 2 introduces a real FK so SendToSupplierModal
-- can auto-group a board's items by supplier.
--
--   supplier_profile_id  uuid  nullable
--                         REFERENCES supplier_profiles(id)
--                         ON DELETE SET NULL
--
-- ON DELETE SET NULL (not CASCADE): supplier rows are soft-deleted
-- (archived_at) in this app, so a hard delete is rare — but if one
-- ever happens, the item must survive with a null link, never vanish.
--
-- supplier_name is intentionally LEFT IN PLACE. It stays as a
-- back-compat / display-fallback column: the new structured picker
-- writes BOTH supplier_profile_id and supplier_name (the resolved
-- name) so legacy reads and historical rows keep working. No data
-- backfill here — existing rows keep their free-text supplier_name
-- and a null supplier_profile_id (they fall into the "unassigned"
-- bucket in the new send flow, which is the correct behaviour).
--
-- No new RLS / GRANT: provisioning_items already has crew row-level
-- policies (ItemDrawer writes the table today) and is NOT column-
-- scoped via GRANTs, so the new column is writable under the
-- existing policy set. Idempotent: ADD COLUMN IF NOT EXISTS.
-- ============================================================

BEGIN;

ALTER TABLE public.provisioning_items
  ADD COLUMN IF NOT EXISTS supplier_profile_id uuid
    REFERENCES public.supplier_profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.provisioning_items.supplier_profile_id IS
  'Structured item→supplier link (Sprint 9c.3 Phase 8). Drives SendToSupplierModal auto-grouping. supplier_name is kept as a back-compat/display-fallback column written alongside this.';

COMMIT;

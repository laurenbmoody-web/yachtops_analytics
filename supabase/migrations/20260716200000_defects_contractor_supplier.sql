-- ─────────────────────────────────────────────────────────────────────────────
-- 20260716200000_defects_contractor_supplier.sql
--
-- WHAT: Link a defect's contractor to a directory entry (supplier_profiles).
--       contractor_name stays as the free-text display/back-compat label; when
--       the crew picks (or adds) a directory vendor, we also record its id so
--       the defect points at the real record — and future defects can reuse it.
--
--       ON DELETE SET NULL: archiving/removing a vendor must not delete or block
--       the defect; it just drops the link and leaves the text name behind.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.defects
  ADD COLUMN IF NOT EXISTS contractor_supplier_id uuid
    REFERENCES public.supplier_profiles(id) ON DELETE SET NULL;

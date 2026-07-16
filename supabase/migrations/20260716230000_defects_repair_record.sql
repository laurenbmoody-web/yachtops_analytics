-- ─────────────────────────────────────────────────────────────────────────────
-- 20260716230000_defects_repair_record.sql
--
-- WHAT: Reshape the defect "fix" fields into a fuller repair record.
--       - scheduled_end_at: repair can span multiple days, so the existing
--         scheduled_fix_at becomes the START and this is the (optional) END.
--       - contractor contact fields that mirror the directory (supplier_profiles):
--         a named contact, email and phone, so details pull through from a linked
--         vendor — or are captured here and pushed into the directory on add.
--
--       due_date is intentionally left in place (other surfaces read it) but is
--       no longer shown in the repair record; "scheduled for" replaces it there.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.defects
  ADD COLUMN IF NOT EXISTS scheduled_end_at        date,
  ADD COLUMN IF NOT EXISTS contractor_contact_name text,
  ADD COLUMN IF NOT EXISTS contractor_email        text,
  ADD COLUMN IF NOT EXISTS contractor_phone        text;

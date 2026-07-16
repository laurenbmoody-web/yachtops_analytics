-- ─────────────────────────────────────────────────────────────────────────────
-- 20260716270000_defects_quote_approval.sql
--
-- WHAT: Sign-off on a repair quote. A high-value quote (or any quote the crew
--       flags) must be approved by a Captain/HOD before the repair can be
--       scheduled. Records the decision + who + when, so there's an audit of the
--       spend authorisation.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.defects
  ADD COLUMN IF NOT EXISTS quote_approval_status  text
    CHECK (quote_approval_status IS NULL OR quote_approval_status IN ('pending', 'approved', 'declined')),
  ADD COLUMN IF NOT EXISTS quote_approved_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quote_approved_by_name text,
  ADD COLUMN IF NOT EXISTS quote_approved_at      timestamptz,
  ADD COLUMN IF NOT EXISTS quote_approval_note    text;

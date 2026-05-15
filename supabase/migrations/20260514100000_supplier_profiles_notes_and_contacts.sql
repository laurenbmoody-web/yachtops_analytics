-- ============================================================
-- supplier_profiles: vessel-side notes + contacts
-- Sprint 9c.2 — supplier detail page redesign
-- ============================================================
--
-- Adds four columns so vessel crew can maintain vessel-side metadata
-- on each supplier they work with:
--
--   notes              text         nullable
--   contacts           jsonb        nullable, default '[]'::jsonb
--   notes_updated_at   timestamptz  nullable
--   notes_updated_by   uuid         nullable, references auth.users
--
-- The new jsonb `contacts` is vessel-side phonebook entries
-- (sales lead, accounts manager, primary contact flag) maintained
-- by crew — distinct from the relational `supplier_contacts` table
-- which models supplier-portal users with login + per-action
-- permissions. Two tables, two roles, two purposes.
--
-- ─── Authorization model after this migration ────────────────
--
-- SELECT — unchanged:
--   • supplier_select_own_profile     (supplier owner reads their row)
--   • crew_read_supplier_profiles     (tenant members read any row)
--
-- UPDATE — split into two flows by column scope:
--   • supplier-owned columns (name, address, VAT, bank, invoice
--     settings, etc.) — writable by the supplier owner only, gated
--     by the existing supplier_update_own_profile RLS policy +
--     existing column-level GRANTs on those columns
--   • vessel-side columns (notes, contacts, notes_updated_at,
--     notes_updated_by) — writable by any active tenant member,
--     gated by the new crew_update_supplier_notes RLS policy +
--     the new column-level GRANT below
--
-- ─── Why column-level GRANT, not a trigger ───────────────────
--
-- Postgres RLS is row-level. The idiomatic Postgres pattern for
-- "writes restricted to specific columns" is column-level GRANTs:
-- the GRANT layer rejects any UPDATE that touches a column outside
-- the granted subset, BEFORE RLS even runs. RLS handles row
-- eligibility; GRANT handles column eligibility. Clean separation.
--
-- A BEFORE UPDATE trigger comparing NEW vs OLD on every column
-- was the alternative considered and rejected — more code, more
-- surface area, runs on every supplier-side update too.
--
-- ─── anon vs authenticated ───────────────────────────────────
--
-- Existing supplier_profiles columns use the same column-level
-- GRANT pattern (granted to both anon and authenticated). The four
-- new vessel-side columns deliberately grant to authenticated only
-- — anon never needs to write crew notes.
-- ============================================================

-- ─── Schema additions ────────────────────────────────────────

ALTER TABLE public.supplier_profiles
  ADD COLUMN IF NOT EXISTS notes              text,
  ADD COLUMN IF NOT EXISTS contacts           jsonb       DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS notes_updated_at   timestamptz,
  ADD COLUMN IF NOT EXISTS notes_updated_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ─── Column-scoped UPDATE GRANT for crew ─────────────────────
--
-- Row eligibility is enforced by the crew_update_supplier_notes
-- policy below. The GRANT here pins down the column subset crew
-- may touch.
GRANT UPDATE (notes, contacts, notes_updated_at, notes_updated_by)
  ON public.supplier_profiles TO authenticated;

-- ─── Crew UPDATE RLS policy ──────────────────────────────────
--
-- Eligibility: any active tenant_members row for auth.uid().
-- Column scoping comes from the GRANT above — this policy
-- intentionally does NOT enumerate columns.
--
-- DROP POLICY IF EXISTS keeps this migration idempotent across
-- re-runs (CI replays, preview-env rebuilds). Postgres CREATE
-- POLICY has no IF NOT EXISTS variant, so the drop+create is the
-- standard pattern. ADD COLUMN IF NOT EXISTS above handles column
-- idempotency; GRANT is naturally idempotent.
DROP POLICY IF EXISTS crew_update_supplier_notes ON public.supplier_profiles;
CREATE POLICY crew_update_supplier_notes
  ON public.supplier_profiles
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.active = true
    )
  );

-- ─── Column comments ─────────────────────────────────────────

COMMENT ON COLUMN public.supplier_profiles.notes IS
  'Vessel-side notes maintained by crew. Updated via crew_update_supplier_notes RLS policy + column-scoped GRANT.';
COMMENT ON COLUMN public.supplier_profiles.contacts IS
  'Vessel-side phonebook entries (jsonb array). Distinct from the relational supplier_contacts table (supplier-portal users with login).';
COMMENT ON COLUMN public.supplier_profiles.notes_updated_at IS
  'Last edit timestamp for the notes column. Set by client on update.';
COMMENT ON COLUMN public.supplier_profiles.notes_updated_by IS
  'User who last edited notes. References auth.users; nulls out if user is deleted.';

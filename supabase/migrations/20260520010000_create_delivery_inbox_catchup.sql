-- ============================================================
-- delivery_inbox — catch-up CREATE TABLE migration.
--
-- The delivery_inbox table predates this migration and exists in
-- production already (created via the Supabase dashboard / SQL editor,
-- never tracked in version control). This migration captures the
-- current schema so a fresh DB built from migrations includes the
-- table.
--
-- The 20260520010000 timestamp is INTENTIONALLY BACKDATED. The table
-- is referenced by later migrations / app code (e.g. cross_department_
-- matches relationships, the inbox page). Sorting this CREATE before
-- anything that references it keeps the migration graph honest. The
-- IF NOT EXISTS guard makes the migration a NO-OP on the live database
-- (the table already exists with all these columns, so nothing
-- changes), and a clean CREATE on any fresh DB.
--
-- HOW THIS WAS RECONSTRUCTED
-- The column list is taken from every INSERT / SELECT / UPDATE call
-- against delivery_inbox in the codebase as of this migration (the
-- Delivery Inbox page, the Returns flow, the return-slip flow, the
-- supplier-confirm public page, cross_department_matches → inbox
-- fall-through, the Tier-2 populator, and getSmartDeliveryCounts).
-- Types are inferred from how each column is used. The IF NOT EXISTS
-- guards mean we are safe to ship — the live table is untouched.
--
-- ⚠️  WHAT'S DELIBERATELY NOT IN THIS MIGRATION
--   • RLS policies. The live table almost certainly has them; we don't
--     know what they are from this sandbox. Replicating them blindly
--     is dangerous. Capture them with `pg_dump --schema-only` (or a
--     SELECT from pg_policies in the dashboard) and add them in a
--     follow-up migration before deleting the live table or rebuilding
--     a tenant DB from migrations.
--   • Indexes. Same reason — diff against the live schema first.
--   • Triggers (e.g. updated_at). Same.
--   • Foreign-key constraints. Listed inline below but verify they
--     match the live constraint names before ALTERing.
--
-- ✅  RECOMMENDED VERIFY-BEFORE-TRUST
--   1. In Supabase SQL Editor, run:
--        SELECT column_name, data_type, is_nullable, column_default
--        FROM information_schema.columns
--        WHERE table_schema = 'public' AND table_name = 'delivery_inbox'
--        ORDER BY ordinal_position;
--   2. Diff against the columns below. Add a follow-up migration for
--      any divergence (extra columns in production, type mismatches,
--      etc.).
--   3. Capture RLS / indexes / triggers and add them as separate
--      follow-up migrations.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.delivery_inbox (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL,
  delivery_batch_id           uuid,
  scanned_by                  uuid,
  scanned_at                  timestamptz NOT NULL DEFAULT now(),
  status                      text NOT NULL DEFAULT 'pending',
  expires_at                  timestamptz,
  dismissed_by                uuid[] DEFAULT ARRAY[]::uuid[],

  -- The item itself (from delivery-note OCR / Tier-2 fall-through)
  raw_name                    text NOT NULL,
  item_reference              text,
  quantity                    numeric,
  ordered_qty                 numeric,
  unit                        text,
  unit_price                  numeric,
  line_total                  numeric,

  -- Supplier snapshot at scan time
  supplier_name               text,
  supplier_phone              text,
  supplier_email              text,
  supplier_address            text,

  -- Original order context
  order_ref                   text,
  order_date                  text,
  delivery_note_url           text,
  delivery_note_ref           text,

  -- Claim
  claimed_by                  uuid,
  claimed_at                  timestamptz,
  claimed_board_id            uuid,

  -- Return flow
  archive_reason              text,
  return_requested_by         uuid,
  return_requested_at         timestamptz,
  return_qty                  numeric,
  return_reason               text,
  return_notes                text,
  return_slip_generated_at    timestamptz,
  return_slip_generated_by    uuid,
  return_slip_token           uuid,
  return_confirmed_at         timestamptz,
  return_confirmed_by         uuid,
  supplier_confirmed_at       timestamptz,
  supplier_signer_name        text,
  supplier_signature          text  -- base64 PNG dataURL
);

COMMENT ON TABLE public.delivery_inbox IS
  'Shared vessel-level pool of unclaimed delivery-note items. Populated by the Tier-2 cross-department match flow when a scanned item does not map to any open board item. Items expire 7 days after scanning (archived client-side on next inbox open; TODO: server-side cron).';

-- Follow-up migrations (NOT created here — capture from the live DB first):
--   - delivery_inbox_rls.sql            (RLS policies)
--   - delivery_inbox_indexes.sql        (tenant/status/scanned_at, return_slip_token)
--   - delivery_inbox_fk_constraints.sql (FKs to tenants / profiles / provisioning_lists / provisioning_deliveries)

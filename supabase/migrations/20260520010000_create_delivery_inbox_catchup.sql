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
-- The column list is taken VERBATIM from the live Supabase
-- information_schema.columns capture (41 columns). Column order,
-- types, nullability, and defaults all match production exactly.
-- Earlier reconstruction-from-code-paths drift has been corrected:
--   • created_at was missing — added.
--   • scanned_at was NOT NULL — relaxed to NULL (matches live).
--   • expires_at was missing its 7-day default — added.
--   • dismissed_by default normalized to '{}'::uuid[] (matches live).
--   • quantity / ordered_qty / return_qty were numeric — fixed to
--     integer (matches live); quantity gets DEFAULT 1.
--   • return_slip_token was uuid — fixed to text (matches live; this
--     is why the RLS policy in the 010001 follow-up uses a plain
--     string comparison, no uuid cast).
-- The IF NOT EXISTS guard means this is still a NO-OP on prod —
-- the live table is untouched.
--
-- ⚠️  WHAT'S DELIBERATELY NOT IN THIS MIGRATION
--   • RLS policies, indexes, FKs, status CHECK — captured in the
--     follow-up 20260520010001_delivery_inbox_rls_and_indexes.sql
--     (also idempotent / no-op on prod).
--   • Triggers (e.g. updated_at). None currently in live — confirm
--     before adding.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.delivery_inbox (
  -- Column order matches the live table's ordinal positions exactly.
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL,
  delivery_batch_id           uuid,
  raw_name                    text NOT NULL,
  quantity                    integer DEFAULT 1,
  unit_price                  numeric,
  unit                        text,
  supplier_name               text,
  scanned_by                  uuid,
  scanned_at                  timestamptz DEFAULT now(),
  claimed_by                  uuid,
  claimed_at                  timestamptz,
  claimed_board_id            uuid,
  status                      text NOT NULL DEFAULT 'pending',
  expires_at                  timestamptz DEFAULT (now() + interval '7 days'),
  created_at                  timestamptz DEFAULT now(),
  dismissed_by                uuid[] DEFAULT '{}'::uuid[],
  archive_reason              text,
  return_requested_by         uuid,
  return_requested_at         timestamptz,
  return_confirmed_by         uuid,
  return_confirmed_at         timestamptz,
  return_notes                text,
  delivery_note_url           text,
  delivery_note_ref           text,
  line_total                  numeric,
  order_ref                   text,
  order_date                  text,
  supplier_phone              text,
  supplier_email              text,
  supplier_address            text,
  item_reference              text,
  ordered_qty                 integer,
  return_qty                  integer,
  return_reason               text,
  return_slip_generated_at    timestamptz,
  return_slip_generated_by    uuid,
  supplier_confirmed_at       timestamptz,
  supplier_signature          text,  -- base64 PNG dataURL
  supplier_signer_name        text,
  return_slip_token           text
);

COMMENT ON TABLE public.delivery_inbox IS
  'Shared vessel-level pool of unclaimed delivery-note items. Populated by the Tier-2 cross-department match flow when a scanned item does not map to any open board item. Items expire 7 days after scanning (archived client-side on next inbox open; TODO: server-side cron).';

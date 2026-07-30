-- ─────────────────────────────────────────────────────────────────────────────
-- 20260730160000_crew_kit_signoff_request.sql
--
-- WHAT: The "send for sign-off" hand-over loop on issued kit. When a crew member
--       joins, Interior gathers the uniform, physically hands it over, then hits
--       "Send for sign-off" — stamping the batch so the crew member is prompted
--       (on their profile) to either acknowledge receipt (existing acknowledged_at
--       flow) OR request a different size. The size-swap request rides back on the
--       same row so Interior can action it from the wardrobe Crew view.
--
--       Columns only — no new table, no RLS change: crew_kit_manage (COMMAND /
--       Interior) already governs writes and the owning crew member reads/updates
--       their own rows, which is exactly who sets each of these.
--
-- IDEMPOTENCY: ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.crew_issued_kit
  add column if not exists signoff_requested_at  timestamptz,   -- Interior sent the batch for sign-off
  add column if not exists signoff_requested_by  uuid,          -- who sent it
  add column if not exists swap_requested_size   text,          -- size the crew member is asking for instead
  add column if not exists swap_requested_at     timestamptz,   -- when they asked
  add column if not exists swap_note             text;          -- optional reason for the swap

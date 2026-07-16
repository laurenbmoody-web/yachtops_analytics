-- Laundry operations fields, all additive + idempotent.
--
--  needed_by         when the piece is promised back (drives overdue).
--  flag / flag_note  mark a piece Damaged or Missing, with a short note.
--  service_location  'onboard' (default) or 'shore' — is it out at a vendor?
--  vendor            shore laundry / dry-cleaner name.
--  sent_at           when it left the vessel.
--  expected_back     when the shore vendor is due to return it.

ALTER TABLE public.laundry_items
  ADD COLUMN IF NOT EXISTS needed_by        timestamptz,
  ADD COLUMN IF NOT EXISTS flag             text,
  ADD COLUMN IF NOT EXISTS flag_note        text,
  ADD COLUMN IF NOT EXISTS service_location text NOT NULL DEFAULT 'onboard',
  ADD COLUMN IF NOT EXISTS vendor           text,
  ADD COLUMN IF NOT EXISTS sent_at          timestamptz,
  ADD COLUMN IF NOT EXISTS expected_back    date;

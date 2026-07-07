-- Per-captain-spell "submitted" markers for the sea-service export step.
-- Filled automatically when a spell's testimonial is exported/copied (Nautilus
-- form, Transport Malta form, MCA testimonial, or Copy for PYA). Progress only —
-- it never changes day totals or excludes service (unlike accounted_years).
-- Shape: { "<vesselId>::<captain>::<from>::<to>": { "at": "yyyy-mm-dd", "via": "pya" }, ... }
alter table public.crew_personal_details
  add column if not exists submitted_testimonials jsonb not null default '{}'::jsonb;

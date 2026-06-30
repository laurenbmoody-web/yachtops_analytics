-- Cabin / berth allocation for a crew member, kept alongside the rest of their
-- employment record. Edited from the profile §07 Contract section and surfaced
-- in the crew-management console.
alter table public.crew_employment
  add column if not exists cabin text;

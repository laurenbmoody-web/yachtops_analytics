-- Capture the holder's passport / ID number on the crew personal details, so it
-- can pre-fill identity fields on official forms (e.g. the Transport Malta deck
-- testimonial "I.D. No.") and contracts, which already reference passport_number.
alter table public.crew_personal_details add column if not exists passport_number text;
comment on column public.crew_personal_details.passport_number is 'Passport or national ID number of the crew member (identity for forms/contracts).';

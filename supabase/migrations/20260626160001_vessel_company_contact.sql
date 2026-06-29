-- Company / shipowner contact details on the vessel, so the Nautilus testimonial
-- Part 1 (Company and contact details) can be filled from vessel settings rather
-- than left blank. company_name + company_address already exist (used for crew
-- contracts); these add the remaining Nautilus Part-1 fields.
alter table public.vessels add column if not exists company_email    text;
alter table public.vessels add column if not exists company_phone    text;
alter table public.vessels add column if not exists company_country  text;
alter table public.vessels add column if not exists company_postcode text;

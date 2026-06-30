-- Interior marking system: a crew member's laundry number and colour, kept with
-- the cabin allocation. Edited from the Issued Kit tab (the interior's domain).
alter table public.crew_employment
  add column if not exists laundry_number text,
  add column if not exists laundry_colour text;

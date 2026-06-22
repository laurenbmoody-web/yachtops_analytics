-- Employer/owner details shown on crew contracts. These fill the
-- {{company_name}} and {{company_address}} tokens when generating a contract
-- from a template. The captain's name ({{captain_name}}) is resolved at
-- generation time from whoever holds the Captain role, so it is not stored here.
alter table public.vessels
  add column if not exists company_name text,
  add column if not exists company_address text;

comment on column public.vessels.company_name is 'Employing entity / yacht owner name shown on crew contracts (fills {{company_name}}).';
comment on column public.vessels.company_address is 'Employing entity postal address block shown on crew contracts (fills {{company_address}}).';

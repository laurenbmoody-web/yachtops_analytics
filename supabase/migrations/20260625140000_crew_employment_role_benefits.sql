-- Employment record additions. Rank/department/vessel now live ON the
-- employment record (previously only on the header banner), plus rotation
-- status, the next crew-change date, and a benefits block.
alter table public.crew_employment add column if not exists rank_held text;
alter table public.crew_employment add column if not exists department text;
alter table public.crew_employment add column if not exists vessel_name text;
alter table public.crew_employment add column if not exists rotation_status text;
alter table public.crew_employment add column if not exists next_crew_change_date date;
-- { travelAllowance, healthInsuranceProvider, healthInsurancePolicy, pension, bonus }
alter table public.crew_employment add column if not exists benefits jsonb not null default '{}'::jsonb;

comment on column public.crew_employment.rank_held is 'Rank/position held on this employment record.';
comment on column public.crew_employment.department is 'Department (Deck, Engineering, Interior, Galley, Other).';
comment on column public.crew_employment.vessel_name is 'Vessel name / reference for this employment.';
comment on column public.crew_employment.rotation_status is 'Current rotation status: Onboard or On leave.';
comment on column public.crew_employment.next_crew_change_date is 'Next scheduled crew-change date.';
comment on column public.crew_employment.benefits is 'Benefits: { travelAllowance, healthInsuranceProvider, healthInsurancePolicy, pension, bonus }.';

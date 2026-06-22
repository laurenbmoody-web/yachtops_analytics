-- Port of embarkation / origin of joining for a crew member's contract.
-- Fills the {{port_of_embarkation}} token (clause "Port of embarkation / Origin
-- of joining") instead of rendering blank.
alter table public.crew_employment add column if not exists port_of_embarkation text;
comment on column public.crew_employment.port_of_embarkation is 'Port of embarkation / origin of joining, shown on the contract (fills {{port_of_embarkation}}).';

-- Repatriation destination for a crew member's contract (clause 9.7
-- "Your repatriation destination is …"). Fills the {{repatriation_destination}}
-- token instead of rendering blank.
alter table public.crew_employment add column if not exists repatriation_destination text;
comment on column public.crew_employment.repatriation_destination is 'Repatriation destination shown on the contract (fills {{repatriation_destination}}).';

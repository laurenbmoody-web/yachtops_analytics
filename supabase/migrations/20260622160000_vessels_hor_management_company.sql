-- Management company recipient for the end-of-month Hours of Rest export.
-- A command user can send the signed HOR pack to the vessel's management
-- company (DPA / shore office); these columns hold who it goes to. Stored on
-- public.vessels alongside the other HOR settings (hor_confirmation_mode etc).
alter table public.vessels
  add column if not exists hor_management_company_name  text,
  add column if not exists hor_management_company_email text;

comment on column public.vessels.hor_management_company_name is 'Management company / shore office name shown in the HOR email greeting.';
comment on column public.vessels.hor_management_company_email is 'Recipient address for the end-of-month signed Hours of Rest export.';

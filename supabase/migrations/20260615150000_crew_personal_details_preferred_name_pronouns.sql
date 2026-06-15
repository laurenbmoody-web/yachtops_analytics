alter table public.crew_personal_details
  add column if not exists preferred_name text,
  add column if not exists pronouns       text;

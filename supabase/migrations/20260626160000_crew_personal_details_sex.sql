-- Add a `sex` field to crew personal details (distinct from pronouns). Used to
-- default the uniform sizing profile (Female → women's, Male → men's) on the
-- Issued Kit tab, and recorded alongside pronouns on Personal Details.
alter table public.crew_personal_details
  add column if not exists sex text;

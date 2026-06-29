-- Extra guest-book detail fields for the crew profile statement. The old
-- "headline / tagline" felt out of place in a guest book, so the UI now uses a
-- "fun fact / hidden talent" box instead, plus a couple of guest-pleasing
-- extras. `headline` is left in place (unused) to avoid dropping any data.
alter table crew_profile_statements add column if not exists fun_fact text;              -- replaces headline in the UI
alter table crew_profile_statements add column if not exists favourite_destination text;
alter table crew_profile_statements add column if not exists years_yachting text;

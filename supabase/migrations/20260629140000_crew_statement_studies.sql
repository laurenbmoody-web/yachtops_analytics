-- One more guest-book detail field for the crew profile statement: what the
-- crew member studied / trained in. Feeds the AI and the guest-book export.
alter table crew_profile_statements add column if not exists studies text;

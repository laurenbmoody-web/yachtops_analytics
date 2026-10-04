-- Off-boarding / archive crew: when a crew member leaves we capture a reason
-- and the leaving date, keep the record (reactivatable, GDPR-retained), and
-- list them under "Past crew". Archive itself is the existing
-- tenant_members.active = false; these columns add the leaving metadata.
alter table public.crew_employment
  add column if not exists reason_for_leaving text;

alter table public.tenant_members
  add column if not exists archived_at timestamptz;

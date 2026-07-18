-- Per-vessel IANA timezone. Drives when the daily laundry "needs attention"
-- push fires (4pm vessel-local), and is available for other vessel-local time
-- needs (see src/utils/vesselLocalTime.js TODO). NULL = not set.
alter table public.vessels add column if not exists timezone text;

-- Backfill existing vessels to a Med default so the daily alert keeps firing
-- at ~4pm without a manual step; each vessel can change it.
update public.vessels set timezone = 'Europe/Malta' where timezone is null;

-- Capture where a crew member is during controlled, known activities so the
-- residency / Schengen / visa engine can attribute a country to those days.
-- Travel already records from/to; this adds a single location to other entries
-- (training in particular). Leave / free-time days stay deliberately unrecorded
-- — we can't and shouldn't track where crew go on their own time.
alter table crew_calendar_entries
  add column if not exists location text,            -- human label, e.g. "Antibes, France"
  add column if not exists location_country text;    -- ISO-2 (or name) for day-counting
